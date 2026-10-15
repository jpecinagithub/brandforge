import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { asc, eq } from 'drizzle-orm';
import { brandKits, landingPages, type Db } from '@brandforge/database';
import { getDb } from '../db.js';
import { Errors } from '../errors.js';
import { projectGuard } from './projects.js';
import { config } from '../config.js';

interface PreviewSection {
  heading: string;
  body: string;
}

interface PreviewSchema {
  template: 'hero' | 'minimal';
  headline: string;
  subheadline: string;
  cta: string;
  sections: PreviewSection[];
}

function text(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') {
    const localized = value as Record<string, unknown>;
    const candidate = localized.es ?? localized.en;
    return typeof candidate === 'string' ? candidate.trim() : fallback;
  }
  return fallback;
}

function normalizeSchema(value: unknown): PreviewSchema {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const sections = Array.isArray(raw.sections)
    ? raw.sections.slice(0, 12).flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const section = item as Record<string, unknown>;
        const heading = text(section.heading ?? section.title);
        const body = text(section.body);
        return heading || body ? [{ heading, body }] : [];
      })
    : [];
  return {
    template: raw.template === 'minimal' ? 'minimal' : 'hero',
    headline: text(raw.headline, 'Una idea preparada para convertirse en campaña'),
    subheadline: text(raw.subheadline, 'Una experiencia de marca clara, relevante y lista para compartir.'),
    cta: text(raw.cta, 'Descubrir la campaña'),
    sections,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[char] ?? char);
}

function safeHex(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export function renderLandingPreview(input: {
  name: string;
  schema: unknown;
  brandKit?: { brandName: string; tagline: string; colors: unknown } | null;
}): string {
  const page = normalizeSchema(input.schema);
  const colors = Array.isArray(input.brandKit?.colors) ? input.brandKit.colors : [];
  const primary = safeHex(colors[0], '#4c1d95');
  const accent = safeHex(colors[1], '#d8b04a');
  const paper = safeHex(colors[2], '#f8f4ea');
  const brand = escapeHtml(input.brandKit?.brandName || input.name);
  const headline = escapeHtml(page.headline);
  const subheadline = escapeHtml(page.subheadline);
  const cta = escapeHtml(page.cta);
  const sections = page.sections.length > 0
    ? page.sections
    : [
        { heading: 'Una propuesta con intención', body: 'Mensaje, identidad y llamada a la acción trabajando como una sola experiencia.' },
        { heading: 'Diseñada para convertir', body: 'Jerarquía clara, contenido directo y una presentación adaptable a cualquier pantalla.' },
        { heading: 'Lista para evolucionar', body: 'Cada versión queda preparada para revisión, aprobación y publicación.' },
      ];

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escapeHtml(input.name)} — Preview</title>
  <style>
    :root{--primary:${primary};--accent:${accent};--paper:${paper};--ink:#172033;--muted:#667085}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
    .hero{position:relative;min-height:72vh;overflow:hidden;padding:32px clamp(24px,7vw,96px) 72px;background:linear-gradient(145deg,var(--primary),#11162b 72%);color:white}
    .orb{position:absolute;border-radius:999px;filter:blur(2px);opacity:.42}.orb.one{width:420px;height:420px;right:-120px;top:-140px;background:var(--accent)}.orb.two{width:260px;height:260px;left:42%;bottom:-180px;border:1px solid rgba(255,255,255,.4)}
    nav{position:relative;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:24px}.brand{font-weight:800;letter-spacing:-.03em}.preview{padding:7px 11px;border:1px solid rgba(255,255,255,.2);border-radius:999px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:rgba(255,255,255,.72)}
    .hero-copy{position:relative;z-index:1;max-width:880px;margin-top:clamp(90px,14vh,150px)}.kicker{display:inline-flex;align-items:center;gap:9px;margin-bottom:20px;color:var(--accent);font-size:13px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}.kicker:before{content:"";width:30px;height:2px;background:currentColor}
    h1{max-width:820px;margin:0;font-family:Georgia,"Times New Roman",serif;font-size:clamp(48px,8vw,104px);font-weight:500;line-height:.94;letter-spacing:-.055em}.lead{max-width:650px;margin:28px 0 34px;color:rgba(255,255,255,.76);font-size:clamp(17px,2vw,22px);line-height:1.65}
    .cta{display:inline-flex;align-items:center;gap:12px;padding:15px 21px;border-radius:999px;background:var(--accent);color:#171717;text-decoration:none;font-weight:800;box-shadow:0 14px 40px rgba(0,0,0,.22)}.cta:after{content:"→";font-size:20px}
    main{padding:clamp(56px,9vw,110px) clamp(24px,7vw,96px)}.intro{display:grid;grid-template-columns:minmax(0,.75fr) minmax(0,1.25fr);gap:48px;align-items:start;margin-bottom:54px}.eyebrow{color:var(--primary);font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase}.intro h2{margin:0;font-family:Georgia,"Times New Roman",serif;font-size:clamp(32px,5vw,64px);line-height:1.04;letter-spacing:-.04em}
    .cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.card{min-height:230px;padding:28px;border:1px solid rgba(23,32,51,.12);border-radius:24px;background:rgba(255,255,255,.56);box-shadow:0 18px 60px rgba(23,32,51,.06)}.number{display:grid;width:36px;height:36px;place-items:center;margin-bottom:44px;border-radius:50%;background:var(--primary);color:white;font-size:12px;font-weight:800}.card h3{margin:0 0 12px;font-family:Georgia,"Times New Roman",serif;font-size:25px}.card p{margin:0;color:var(--muted);line-height:1.65}
    footer{display:flex;justify-content:space-between;gap:24px;padding:26px clamp(24px,7vw,96px);border-top:1px solid rgba(23,32,51,.12);color:var(--muted);font-size:12px}
    @media(max-width:760px){.hero{min-height:78vh}.intro{grid-template-columns:1fr;gap:16px}.cards{grid-template-columns:1fr}.card{min-height:0}.preview{display:none}footer{flex-direction:column}}
  </style>
</head>
<body>
  <header class="hero">
    <span class="orb one"></span><span class="orb two"></span>
    <nav><div class="brand">${brand}</div><div class="preview">BrandForge live preview</div></nav>
    <div class="hero-copy"><div class="kicker">Campaña de marca</div><h1>${headline}</h1><p class="lead">${subheadline}</p><a class="cta" href="#contenido">${cta}</a></div>
  </header>
  <main id="contenido">
    <section class="intro"><div class="eyebrow">La propuesta</div><h2>Una historia coherente en cada punto de contacto.</h2></section>
    <section class="cards">${sections.map((section, index) => `<article class="card"><div class="number">0${index + 1}</div><h3>${escapeHtml(section.heading)}</h3><p>${escapeHtml(section.body)}</p></article>`).join('')}</section>
  </main>
  <footer><span>${brand}</span><span>Vista previa generada por BrandForge AI</span></footer>
</body>
</html>`;
}

export async function landingPageRoutes(app: FastifyInstance): Promise<void> {
  const db: Db = getDb();

  const listLandingPages = async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { projectId?: string; campaignId?: string };
    const projectId = params.campaignId ?? params.projectId ?? '';
    const project = await projectGuard(db, request, reply, projectId, 'viewer');
    if (!project) return;
    const rows = await db
      .select()
      .from(landingPages)
      .where(eq(landingPages.projectId, projectId))
      .orderBy(asc(landingPages.createdAt));
    return { landingPages: rows.map(({ projectId: campaignId, ...page }) => ({ ...page, campaignId })) };
  };
  app.get('/api/v1/campaigns/:campaignId/landing-pages', { preHandler: [app.authenticate] }, listLandingPages);
  app.get('/api/v1/projects/:projectId/landing-pages', { preHandler: [app.authenticate] }, listLandingPages);

  app.get('/api/v1/landing-pages/:landingPageId/preview', { preHandler: [app.authenticate] }, async (request, reply) => {
    const { landingPageId } = request.params as { landingPageId: string };
    const [page] = await db.select().from(landingPages).where(eq(landingPages.id, landingPageId)).limit(1);
    if (!page) return Errors.notFound(reply);
    const project = await projectGuard(db, request, reply, page.projectId, 'viewer');
    if (!project) return;
    const [kit] = await db.select().from(brandKits).where(eq(brandKits.projectId, page.projectId)).limit(1);
    const allowedFrameAncestors = config.corsOrigins.map((origin) => origin.replace(/[^a-zA-Z0-9:/.\-_]/g, '')).join(' ');
    reply.removeHeader('x-frame-options');
    reply
      .header('cache-control', 'private, no-store')
      .header('content-security-policy', `default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self' ${allowedFrameAncestors}`)
      .header('referrer-policy', 'no-referrer')
      .type('text/html; charset=utf-8');
    return renderLandingPreview({
      name: page.name,
      schema: page.schema,
      brandKit: kit ? { brandName: kit.brandName, tagline: kit.tagline, colors: kit.colors } : null,
    });
  });
}
