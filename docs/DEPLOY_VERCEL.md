# Deploy — Vercel (frontend)

> **For:** Jon, clicking in the Vercel dashboard himself.
> **Standing rule:** the agent NEVER touches Vercel — no imports, no env vars, no
> deploys. Every step below is yours.

The frontend (`apps/web`) is a static SPA. The backend already runs on Oracle and
is exposed at `https://jpecina.duckdns.org/brandforge/api` (see
`docs/DEPLOY_ORACLE.md` — do that first, then come back here).

## Steps

1. **Open the Vercel dashboard** → https://vercel.com → *Add New…* → *Project*.
2. **Import** the GitHub repo **`jpecinagithub/brandforge`** (grant access if asked).
3. **Configure the project:**
   - *Framework Preset:* Vite
   - *Root Directory:* `apps/web` ← important: not the repo root
   - *Build Command:* `npm run build`
   - *Output Directory:* `dist`
   - *Install Command:* `npm install` (default is fine)
4. **Environment variables** — add for **Production** (and Preview if you want):
   - `VITE_API_URL` = `https://jpecina.duckdns.org/brandforge/api`
   
   > ⚠️ Vite bakes env vars in at **build time**. If you change `VITE_API_URL`
   > later, you must **redeploy** for it to take effect.
5. Click **Deploy**. Wait for the build to succeed.
6. **Enable Web Analytics:** the code already includes `@vercel/analytics`.
   In the project dashboard go to the **Analytics** tab → **Enable**.
   (No code change needed — the owner enables it in the dashboard, per standing rule.)
7. **Smoke test** the deployed URL:
   - The landing page loads (EN default; ES toggle works).
   - Sign in works against the Oracle API (check the browser devtools network tab:
     calls go to `https://jpecina.duckdns.org/brandforge/api/…`).
   - The PWA installs (address-bar install icon) and the icon shows the violet
     “BF” monogram (`apps/web/public/icons/`).
8. **Custom domain (optional):** *Settings → Domains* → add your domain and follow
   the DNS instructions. If you do, update `FRONTEND_URL` / `CORS_ORIGIN` in the
   Oracle `.env` and restart the api container:
   `docker compose -f infrastructure/docker/docker-compose.yml up -d api`.

## What the agent does NOT do here

- No importing the repo, no setting env vars, no pressing Deploy, no enabling
  Analytics. If any step fails, paste the Vercel build log here and we'll fix the
  code — the clicking stays yours.

## Rollback on Vercel

*Deployments* tab → open the previous good deployment → *⋯* → **Promote to
Production**. Instant, no code changes.
