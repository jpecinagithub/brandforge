# Deploy — Vercel (frontend)

> **Scope:** static frontend deployment. Production data, OpenRouter credentials
> and agent execution stay on Oracle.

The frontend (`apps/web`) is a static SPA. The backend already runs on Oracle and
is exposed at `https://jpecina.duckdns.org/brandforge/api` (see
`docs/DEPLOY_ORACLE.md` — do that first, then come back here).

## Initial project setup

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
5. Click **Deploy** and wait for the build to succeed. Once linked, pushes to
   `main` create production deployments automatically through the Git integration.
6. **Enable Web Analytics:** the code already includes `@vercel/analytics`.
   In the project dashboard go to the **Analytics** tab → **Enable**.
   No code change is needed.
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

## Release verification

- Confirm the intended Vercel project and production target before releasing.
- Require a successful local build and tests before pushing `main`.
- Inspect the resulting deployment until it reaches `Ready`.
- Verify the production alias, authenticated workspace and browser console.
- Never expose provider or backend secrets as `VITE_*` variables.

## Rollback on Vercel

*Deployments* tab → open the previous good deployment → *⋯* → **Promote to
Production**. Instant, no code changes.
