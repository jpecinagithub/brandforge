# Deploy — Oracle Cloud (production backend)

> **For:** Jon, running commands himself on his Oracle server.
> **Scope:** backend only (Fastify API + Postgres + worker in Docker). The frontend
> deploys on Vercel — see `docs/DEPLOY_VERCEL.md`; the agent never touches Vercel.
>
> Conventions used below (standing rules):
> - One paste-ready block per job. The **purpose comes before** the block.
> - Shell label: **Oracle (`ubuntu@oracle`)** — every block runs there unless stated.
> - The VM running this agent **cannot SSH out**, so every step is guided-hands.
> - Backend port **3013** on **127.0.0.1** is reserved for BrandForge (Oracle's port
>   3001 is already ERP3 — do not use it).
> - `jpecina.duckdns.org` is served by the **`mi-gps`** nginx server block
>   (server_name match). Path locations for this host go in
>   `/etc/nginx/sites-enabled/mi-gps` **before** its catch-all `location /`.
>   Never put them in `proyectos`' `default_server` — they will 404 silently.
> - **Never leave backup files inside `sites-enabled/`** (nginx includes the whole
>   dir → duplicate-server errors). Backups go to `/root/nginx-backups/`.

---

## (a) Install Docker + Compose plugin

**Purpose:** the production stack (API, Postgres, worker) runs as containers.
Skip this step if `docker compose version` already works.

```bash
# ── Shell: Oracle (ubuntu@oracle) ──────────────────────────────────────────
# Purpose: install Docker Engine + the compose plugin (Ubuntu 24.04 aarch64).
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo usermod -aG docker ubuntu
# Log out and back in (or run `newgrp docker`), then verify:
docker --version && docker compose version
```

---

## (b) Clone the repo + create the production env file

**Purpose:** get the code on the server and create the *real* `.env` (never committed).

```bash
# ── Shell: Oracle (ubuntu@oracle) ──────────────────────────────────────────
# Purpose: clone the repo and build the production .env from the example.
mkdir -p ~/apps && cd ~/apps
git clone https://github.com/jpecinagithub/brandforge.git
cd brandforge
cp .env.example .env
nano .env
```

Set inside `.env` (production values):

```ini
NODE_ENV=production
PORT=3013
POSTGRES_PASSWORD=<long random password — generate with: openssl rand -base64 32>
DATABASE_URL=postgresql://brandforge:<same password>@postgres:5432/brandforge
FRONTEND_URL=https://<tu-dominio-vercel>.vercel.app
CORS_ORIGIN=https://<tu-dominio-vercel>.vercel.app
MAIL_TRANSPORT=smtp
MAIL_FROM="BrandForge <no-reply@tu-dominio>"
SMTP_HOST=<tu smtp>        # e.g. smtp.tu-proveedor.com
SMTP_PORT=587
SMTP_USER=<usuario>
SMTP_PASS=<contraseña>
STORAGE_PATH=/data/brandforge/storage
MAILDIR_PATH=/data/brandforge/maildir
VITE_API_URL=https://jpecina.duckdns.org/brandforge/api
# OPENROUTER_* : Phase 3 — leave empty for now.
```

> Keep this `.env` only on the server (0600). It is git-ignored.

---

## (c) Build and start the stack

**Purpose:** build the aarch64 images and start postgres + api (+ worker) with
restart policies, bound to 127.0.0.1:3013.

```bash
# ── Shell: Oracle (ubuntu@oracle) ──────────────────────────────────────────
# Purpose: build images and start the stack detached.
cd ~/apps/brandforge
docker compose -f infrastructure/docker/docker-compose.yml up -d --build
docker compose -f infrastructure/docker/docker-compose.yml ps
# Expected: postgres (healthy), api (running), worker (running)
```

Verify the API answers on loopback (not exposed publicly — nginx is the front door):

```bash
# ── Shell: Oracle (ubuntu@oracle) ──────────────────────────────────────────
# Purpose: smoke-test the API on loopback.
curl -s http://127.0.0.1:3013/api/v1/health | head -c 300; echo
```

If it fails, read the logs before anything else:

```bash
# ── Shell: Oracle (ubuntu@oracle) ──────────────────────────────────────────
docker compose -f infrastructure/docker/docker-compose.yml logs --tail=80 api
```

Then migrate + seed (seed is a no-op in production unless explicitly allowed —
demo data stays local):

```bash
# ── Shell: Oracle (ubuntu@oracle) ──────────────────────────────────────────
# Purpose: apply DB migrations inside the api container.
cd ~/apps/brandforge
docker compose -f infrastructure/docker/docker-compose.yml exec api npm run db:migrate
```

---

## (d) nginx: expose the API at `https://jpecina.duckdns.org/brandforge/api/`

**Purpose:** the API listens only on 127.0.0.1; nginx terminates TLS and routes
the `/brandforge/api/` path to it. (The frontend itself is on Vercel — no
`/brandforge/` static block is needed. If you ever want the API docs or a
status page served statically, add it later; not required now.)

**Step 1 — back up the current nginx config** (outside `sites-enabled/`):

```bash
# ── Shell: Oracle (ubuntu@oracle) ──────────────────────────────────────────
# Purpose: timestamped backup of the mi-gps vhost before editing.
sudo mkdir -p /root/nginx-backups
sudo cp /etc/nginx/sites-enabled/mi-gps "/root/nginx-backups/mi-gps.$(date +%F-%H%M%S).bak"
```

**Step 2 — add the location block.** Open the file and insert the block **before**
the catch-all `location /` inside the 443 server block (and, if the file has one,
the port-80 block too — or rely on the existing http→https redirect):

```bash
# ── Shell: Oracle (ubuntu@oracle) ──────────────────────────────────────────
sudo nano /etc/nginx/sites-enabled/mi-gps
```

Paste (inside the `server { listen 443 ssl; server_name jpecina.duckdns.org; … }`
block, **before** `location /`):

```nginx
    # BrandForge AI — API (Fastify on 127.0.0.1:3013)
    location /brandforge/api/ {
        proxy_pass http://127.0.0.1:3013/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
        client_max_body_size 30m;
    }
```

**Step 3 — test and reload:**

```bash
# ── Shell: Oracle (ubuntu@oracle) ──────────────────────────────────────────
# Purpose: validate nginx config, then reload without dropping connections.
sudo nginx -t && sudo systemctl reload nginx
curl -s https://jpecina.duckdns.org/brandforge/api/v1/health | head -c 300; echo
```

> If `nginx -t` fails, fix the error before reloading — never reload a broken
> config. Your backup is in `/root/nginx-backups/`.

---

## (e) Restart behaviour (no systemd units needed)

**Purpose:** containers must come back after a reboot without manual steps.
The compose file sets `restart: unless-stopped` on every service — that is the
whole mechanism. Just make sure Docker itself starts on boot:

```bash
# ── Shell: Oracle (ubuntu@oracle) ──────────────────────────────────────────
# Purpose: enable Docker at boot so `unless-stopped` containers return alone.
sudo systemctl enable docker
sudo systemctl is-enabled docker
# Optional reboot test (do it when nothing else critical is running):
# sudo reboot
# …after reboot: docker compose -f ~/apps/brandforge/infrastructure/docker/docker-compose.yml ps
```

---

## (f) Promote the first admin

**Purpose:** the first registered user is a plain user; promote yours to `admin`
from inside the api container. (Adjust the script name to whatever
`apps/api/package.json` defines — e.g. `admin:promote`.)

```bash
# ── Shell: Oracle (ubuntu@oracle) ──────────────────────────────────────────
# Purpose: register first via the web app, then promote that email to admin.
cd ~/apps/brandforge
docker compose -f infrastructure/docker/docker-compose.yml exec api npm run admin:promote -- --email=tu@email.com
```

Verify: sign in on the web app — the admin section should now be visible.

---

## Rollback

**Purpose:** if a deploy misbehaves, get back to the previous state quickly.

```bash
# ── Shell: Oracle (ubuntu@oracle) ──────────────────────────────────────────
# Purpose: stop the stack and restore the previous nginx vhost.
cd ~/apps/brandforge
docker compose -f infrastructure/docker/docker-compose.yml down
# Restore nginx (pick the newest backup):
ls -t /root/nginx-backups/mi-gps.*.bak | head -3
sudo cp /root/nginx-backups/mi-gps.<FECHA>.bak /etc/nginx/sites-enabled/mi-gps
sudo nginx -t && sudo systemctl reload nginx
# To roll the CODE back: git log --oneline -5, then
git fetch origin && git checkout <previous-sha>
docker compose -f infrastructure/docker/docker-compose.yml up -d --build
```

Database migrations are one-way by design — if a migration itself is the problem,
restore from the pre-deploy `pg_dump` (see `docs/BACKUP.md`) rather than guessing.

---

## Updating later

```bash
# ── Shell: Oracle (ubuntu@oracle) ──────────────────────────────────────────
# Purpose: pull, rebuild, migrate — the standard update cycle.
cd ~/apps/brandforge
git pull --ff-only
docker compose -f infrastructure/docker/docker-compose.yml up -d --build
docker compose -f infrastructure/docker/docker-compose.yml exec api npm run db:migrate
docker compose -f infrastructure/docker/docker-compose.yml ps
```
