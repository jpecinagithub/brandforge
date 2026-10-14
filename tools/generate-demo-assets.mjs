#!/usr/bin/env node
/**
 * tools/generate-demo-assets.mjs
 * ---------------------------------------------------------------------------
 * Generates clearly-watermarked DEMO brand assets for BrandForge AI seeds and
 * landing-page examples.
 *
 *  - All artwork is ORIGINAL (simple vector shapes + text), built as inline
 *    SVG and rasterised with `sharp` (SVG -> PNG).
 *  - Every DEMO BRAND image (logo, hero, posts, poster) carries a gold "DEMO"
 *    ribbon burned into the top-left corner so nobody mistakes these for
 *    final/AI-generated art. The PWA icons are product chrome (the app's real
 *    install icon) and intentionally carry NO ribbon.
 *  - `sharp` is NOT a monorepo dependency. Install it in an isolated tool env:
 *        cd /tmp && npm init -y && npm i sharp
 *    then run either:
 *        node tools/generate-demo-assets.mjs
 *        NODE_PATH=/tmp/sharp-tool/node_modules node tools/generate-demo-assets.mjs
 *        SHARP_PATH=/tmp/sharp-tool/node_modules/sharp node tools/generate-demo-assets.mjs
 *  - Idempotent: re-running simply overwrites the same files.
 *
 * Outputs:
 *   packages/database/seed-assets/   brand demo assets (logo, hero, posts, poster)
 *   apps/web/public/icons/           PWA icons
 *   apps/web/public/demo/            copies for the landing page examples
 */
import { mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

/* ------------------------------------------------------------------ sharp */
function tryRequire(from, id) {
  try {
    return createRequire(from)(id);
  } catch {
    return null;
  }
}
const sharp =
  tryRequire('/tmp/sharp-tool/package.json', 'sharp') ||
  (process.env.SHARP_PATH ? tryRequire(join(process.env.SHARP_PATH, 'package.json'), 'sharp') : null) ||
  tryRequire(join(ROOT, 'package.json'), 'sharp'); // works with NODE_PATH too

if (!sharp) {
  console.error(
    'ERROR: sharp not found. Install it in an isolated tool env (NOT in the monorepo):\n' +
      '  cd /tmp && npm init -y && npm i sharp\n' +
      'then re-run this script (optionally with NODE_PATH=/tmp/sharp-tool/node_modules).'
  );
  process.exit(1);
}

/* ------------------------------------------------------------------ style */
const C = {
  green: '#1E3D2F',
  greenMid: '#2A523D',
  greenDark: '#14291F',
  greenDeep: '#0E241B',
  gold: '#C9A227',
  goldLight: '#E3C766',
  goldDark: '#8A6F1C',
  cream: '#F5EFE0',
  creamBg: '#F7F1E3',
  creamDim: '#D9CDAF',
  wine: '#5A1F1F',
  wineDark: '#3A1414',
  ink: '#2B2118',
  violet: '#7C3AED',
  violetDark: '#4C1D95',
};
const SERIF = "Georgia, 'DejaVu Serif', serif";
const SANS = "Verdana, 'DejaVu Sans', sans-serif";

/** Diagonal gold "DEMO" ribbon pinned to the top-left corner. */
const demoRibbon = (L, fs) => `
  <g>
    <path d="M0,0 L${L},0 L0,${L} Z" fill="${C.gold}"/>
    <path d="M0,0 L${L},0 L0,${L} Z" fill="none" stroke="${C.goldDark}" stroke-width="${Math.max(2, fs / 12)}"/>
    <text x="${L * 0.40}" y="${L * 0.40}" text-anchor="middle" dominant-baseline="central"
      transform="rotate(-45 ${L * 0.40} ${L * 0.40})"
      font-family="${SANS}" font-weight="bold" font-size="${fs}" letter-spacing="4"
      fill="${C.greenDeep}">DEMO</text>
  </g>`;

const svgDoc = (w, h, body) =>
  `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;

/** Stylised coffee-cup line art centred at (cx, cy), drawn at scale s. */
const cup = (cx, cy, s, stroke) => `
  <g transform="translate(${cx} ${cy}) scale(${s})" fill="none" stroke="${stroke}"
     stroke-width="11" stroke-linecap="round" stroke-linejoin="round">
    <path d="M-100 -60 L100 -60 L68 98 L-68 98 Z"/>
    <path d="M100 -38 C156 -38 156 46 84 56"/>
    <path d="M-48 -102 C-60 -130 -36 -142 -48 -170"/>
    <path d="M12 -102 C0 -130 24 -142 12 -170"/>
    <path d="M72 -102 C60 -130 84 -142 72 -170"/>
    <line x1="-114" y1="126" x2="114" y2="126" stroke-width="8"/>
  </g>`;

/* ------------------------------------------------------------------ assets */
function logoCafeAroma() {
  const w = 800;
  const h = 800;
  return svgDoc(
    w,
    h,
    `
  <defs>
    <radialGradient id="lbg" cx="50%" cy="40%" r="78%">
      <stop offset="0%" stop-color="${C.greenMid}"/>
      <stop offset="58%" stop-color="${C.green}"/>
      <stop offset="100%" stop-color="${C.greenDark}"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#lbg)"/>
  <circle cx="400" cy="400" r="364" fill="none" stroke="${C.gold}" stroke-width="7"/>
  <circle cx="400" cy="400" r="346" fill="none" stroke="${C.gold}" stroke-width="2" opacity="0.7"/>
  ${cup(400, 330, 1.0, C.gold)}
  <g fill="${C.gold}">
    <path d="M196 566 l10 14 -10 14 -10 -14 Z"/>
    <path d="M604 566 l10 14 -10 14 -10 -14 Z"/>
  </g>
  <text x="406" y="572" text-anchor="middle" font-family="${SERIF}" font-size="66"
    letter-spacing="12" fill="${C.cream}">CAFÉ AROMA</text>
  <text x="404" y="634" text-anchor="middle" font-family="${SANS}" font-size="26"
    letter-spacing="8" fill="${C.gold}">· BILBAO ·</text>
  ${demoRibbon(200, 30)}`
  );
}

function heroNavidad() {
  const w = 1600;
  const h = 900;
  const bokeh = [
    [180, 150, 90, 0.5], [520, 90, 60, 0.35], [900, 140, 110, 0.45], [1280, 110, 70, 0.4],
    [1450, 300, 100, 0.35], [120, 520, 80, 0.4], [420, 700, 110, 0.35], [760, 780, 70, 0.45],
    [1120, 720, 95, 0.4], [1420, 640, 65, 0.5], [300, 330, 45, 0.3], [1330, 450, 50, 0.3],
  ]
    .map(([x, y, r, o]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#bok)" opacity="${o}"/>`)
    .join('');
  const sparkles = [
    [240, 220], [700, 180], [1080, 240], [1520, 480], [640, 640], [980, 620], [180, 760], [1300, 780],
  ]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5" fill="${C.goldLight}" opacity="0.85"/>`)
    .join('');
  return svgDoc(
    w,
    h,
    `
  <defs>
    <linearGradient id="hbg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.greenDeep}"/>
      <stop offset="0.55" stop-color="${C.green}"/>
      <stop offset="1" stop-color="${C.greenDark}"/>
    </linearGradient>
    <radialGradient id="bok">
      <stop offset="0%" stop-color="${C.goldLight}" stop-opacity="0.6"/>
      <stop offset="100%" stop-color="${C.goldLight}" stop-opacity="0"/>
    </radialGradient>
    <filter id="soft" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="28"/>
    </filter>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#hbg)"/>
  <g filter="url(#soft)">${bokeh}</g>
  ${sparkles}
  <text x="800" y="392" text-anchor="middle" font-family="${SERIF}" font-size="118" fill="${C.cream}">Magia de Navidad</text>
  <text x="800" y="524" text-anchor="middle" font-family="${SERIF}" font-size="118" fill="${C.cream}">en cada taza</text>
  <g stroke="${C.gold}" stroke-width="2">
    <line x1="560" y1="600" x2="740" y2="600"/>
    <line x1="860" y1="600" x2="1040" y2="600"/>
  </g>
  <path d="M800 588 l14 12 -14 12 -14 -12 Z" fill="${C.gold}"/>
  <text x="808" y="668" text-anchor="middle" xml:space="preserve" font-family="${SANS}" font-size="32"
    fill="${C.gold}"><tspan letter-spacing="8">CAF </tspan><tspan>É</tspan><tspan letter-spacing="8"> AROMA · BILBAO</tspan></text>
  <!-- NOTE: the É sits in its own tspan WITHOUT letter-spacing: librsvg detaches
       the accent of É when letter-spacing is applied at small sizes. -->
  ${demoRibbon(240, 34)}`
  );
}

function postInstagram1() {
  const w = 1080;
  const h = 1080;
  return svgDoc(
    w,
    h,
    `
  <rect width="${w}" height="${h}" fill="${C.creamBg}"/>
  <rect x="46" y="46" width="988" height="988" fill="none" stroke="${C.green}" stroke-width="8"/>
  <rect x="72" y="72" width="936" height="936" fill="none" stroke="${C.gold}" stroke-width="3"/>
  <text x="540" y="470" text-anchor="middle" font-family="${SERIF}" font-weight="bold"
    font-size="290" fill="${C.green}">2×1</text>
  <text x="540" y="590" text-anchor="middle" font-family="${SERIF}" font-size="72" fill="${C.green}">en capuchinos</text>
  <line x1="390" y1="650" x2="690" y2="650" stroke="${C.gold}" stroke-width="4"/>
  <rect x="330" y="700" width="420" height="112" rx="56" fill="${C.green}"/>
  <text x="540" y="774" text-anchor="middle" font-family="${SANS}" font-weight="bold"
    font-size="46" letter-spacing="6" fill="${C.cream}">DICIEMBRE</text>
  <text x="540" y="940" text-anchor="middle" font-family="${SANS}" font-size="30"
    letter-spacing="4" fill="${C.goldDark}">Café Aroma · Bilbao</text>
  ${demoRibbon(220, 32)}`
  );
}

function postInstagram2() {
  const w = 1080;
  const h = 1080;
  return svgDoc(
    w,
    h,
    `
  <defs>
    <linearGradient id="p2bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.greenMid}"/>
      <stop offset="1" stop-color="${C.greenDeep}"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#p2bg)"/>
  <circle cx="540" cy="196" r="118" fill="none" stroke="${C.gold}" stroke-width="5"/>
  <text x="540" y="212" text-anchor="middle" font-family="${SANS}" font-weight="bold"
    font-size="44" letter-spacing="4" fill="${C.gold}">NUEVO</text>
  <text x="540" y="500" text-anchor="middle" font-family="${SERIF}" font-size="168" fill="${C.cream}">Turrón</text>
  <text x="540" y="668" text-anchor="middle" font-family="${SERIF}" font-size="168" fill="${C.cream}">Latte</text>
  ${cup(540, 830, 0.62, C.goldLight)}
  <text x="540" y="986" text-anchor="middle" font-family="${SANS}" font-size="32"
    letter-spacing="3" fill="${C.gold}">La Navidad sabe mejor aquí</text>
  ${demoRibbon(220, 32)}`
  );
}

/** Simple eighth-note shape centred at (x, y), scale s, colour c. */
const musicNote = (x, y, s, c) => `
  <g transform="translate(${x} ${y}) scale(${s})" fill="${c}">
    <ellipse cx="0" cy="0" rx="26" ry="20" transform="rotate(-18)"/>
    <rect x="18" y="-150" width="10" height="150"/>
    <path d="M28 -150 C70 -140 84 -110 78 -70 C70 -100 52 -118 28 -122 Z"/>
  </g>`;

function postInstagram3() {
  const w = 1080;
  const h = 1080;
  return svgDoc(
    w,
    h,
    `
  <defs>
    <linearGradient id="p3bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.wine}"/>
      <stop offset="1" stop-color="${C.wineDark}"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#p3bg)"/>
  <rect x="46" y="46" width="988" height="988" fill="none" stroke="${C.gold}" stroke-width="4" opacity="0.8"/>
  ${musicNote(210, 300, 1.1, C.goldLight)}
  ${musicNote(880, 760, 0.9, C.goldLight)}
  ${musicNote(860, 260, 0.7, C.gold)}
  <text x="540" y="470" text-anchor="middle" font-family="${SERIF}" font-size="112" fill="${C.cream}">Villancicos</text>
  <text x="540" y="596" text-anchor="middle" font-family="${SERIF}" font-size="112" fill="${C.cream}">en directo</text>
  <rect x="360" y="680" width="360" height="120" rx="12" fill="none" stroke="${C.gold}" stroke-width="5"/>
  <text x="540" y="762" text-anchor="middle" font-family="${SANS}" font-weight="bold"
    font-size="62" letter-spacing="6" fill="${C.gold}">21 DIC</text>
  <text x="540" y="940" text-anchor="middle" font-family="${SANS}" font-size="30"
    letter-spacing="4" fill="${C.creamDim}">Entrada libre · Café Aroma</text>
  ${demoRibbon(220, 32)}`
  );
}

function cartelA3() {
  const w = 1240;
  const h = 1754;
  const rows = [
    ['Fecha:', '___ de diciembre de 2026', 880],
    ['Hora:', '___', 972],
    ['Lugar:', '____________________', 1064],
    ['Entradas:', '__________________', 1156],
  ]
    .map(
      ([k, v, y]) => `
    <text x="220" y="${y}" font-family="${SANS}" font-weight="bold" font-size="44" fill="${C.gold}">${k}</text>
    <text x="470" y="${y}" font-family="${SANS}" font-size="44" fill="${C.cream}">${v}</text>`
    )
    .join('');
  return svgDoc(
    w,
    h,
    `
  <defs>
    <linearGradient id="cbg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.greenDeep}"/>
      <stop offset="0.5" stop-color="${C.green}"/>
      <stop offset="1" stop-color="${C.greenDark}"/>
    </linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#cbg)"/>
  <rect x="36" y="36" width="1168" height="1682" fill="none" stroke="${C.gold}" stroke-width="8"/>
  <rect x="60" y="60" width="1120" height="1634" fill="none" stroke="${C.gold}" stroke-width="2" opacity="0.6"/>
  <text x="626" y="208" text-anchor="middle" font-family="${SANS}" font-size="36"
    letter-spacing="8" fill="${C.gold}">CAFÉ AROMA · BILBAO PRESENTA</text>
  <text x="620" y="392" text-anchor="middle" font-family="${SERIF}" font-size="128" fill="${C.cream}">GRAN FESTIVAL</text>
  <text x="620" y="536" text-anchor="middle" font-family="${SERIF}" font-size="128" fill="${C.cream}">DE NAVIDAD</text>
  <g stroke="${C.gold}" stroke-width="3">
    <line x1="320" y1="620" x2="560" y2="620"/>
    <line x1="680" y1="620" x2="920" y2="620"/>
  </g>
  <path d="M620 604 l20 16 -20 16 -20 -16 Z" fill="${C.gold}"/>
  <rect x="140" y="760" width="960" height="520" fill="none" stroke="${C.gold}" stroke-width="4"/>
  ${rows}
  <text x="624" y="1430" text-anchor="middle" font-family="${SERIF}" font-size="66"
    letter-spacing="4" fill="${C.gold}">¡TE ESPERAMOS!</text>
  <text x="620" y="1620" text-anchor="middle" font-family="${SANS}" font-size="26"
    fill="${C.creamDim}">Cartel de demostración · Contenido de ejemplo</text>
  ${demoRibbon(300, 44)}`
  );
}

/* ------------------------------------------------------------------ icons */
function pwaIcon(size, { maskable = false, apple = false } = {}) {
  const corner = maskable || apple ? 0 : Math.round(size * 0.22);
  const fontSize = Math.round(size * (maskable ? 0.42 : 0.47));
  // NOTE: PWA icons are PRODUCT chrome (the app's real install icon), not demo
  // brand content, so they intentionally do NOT carry the DEMO ribbon.
  return svgDoc(
    size,
    size,
    `
  <defs>
    <linearGradient id="vg${size}${maskable ? 'm' : ''}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.violet}"/>
      <stop offset="1" stop-color="${C.violetDark}"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" rx="${corner}" fill="url(#vg${size}${maskable ? 'm' : ''})"/>
  <ellipse cx="${size / 2}" cy="${size * 0.18}" rx="${size * 0.42}" ry="${size * 0.16}"
    fill="#FFFFFF" opacity="0.08"/>
  <text x="${size / 2}" y="${size / 2}" text-anchor="middle" dominant-baseline="central"
    font-family="${SERIF}" font-weight="bold" font-size="${fontSize}" fill="#FFFFFF">BF</text>`
  );
}

/* ------------------------------------------------------------------ main */
const JOBS = [
  { file: 'packages/database/seed-assets/logo-cafe-aroma.png', w: 800, h: 800, make: logoCafeAroma },
  { file: 'packages/database/seed-assets/hero-navidad.png', w: 1600, h: 900, make: heroNavidad },
  { file: 'packages/database/seed-assets/post-instagram-1.png', w: 1080, h: 1080, make: postInstagram1 },
  { file: 'packages/database/seed-assets/post-instagram-2.png', w: 1080, h: 1080, make: postInstagram2 },
  { file: 'packages/database/seed-assets/post-instagram-3.png', w: 1080, h: 1080, make: postInstagram3 },
  { file: 'packages/database/seed-assets/cartel-a3.png', w: 1240, h: 1754, make: cartelA3 },
  { file: 'apps/web/public/icons/icon-192.png', w: 192, h: 192, make: () => pwaIcon(192) },
  { file: 'apps/web/public/icons/icon-512.png', w: 512, h: 512, make: () => pwaIcon(512) },
  { file: 'apps/web/public/icons/maskable-512.png', w: 512, h: 512, make: () => pwaIcon(512, { maskable: true }) },
  { file: 'apps/web/public/icons/apple-touch-icon.png', w: 180, h: 180, make: () => pwaIcon(180, { apple: true }) },
];

const COPIES = [
  ['packages/database/seed-assets/hero-navidad.png', 'apps/web/public/demo/hero-navidad.png'],
  ['packages/database/seed-assets/post-instagram-1.png', 'apps/web/public/demo/post-instagram-1.png'],
];

async function main() {
  console.log('BrandForge AI — demo asset generator');
  console.log('Fonts: Georgia -> DejaVu Serif fallback (system fonts, no downloads).');
  for (const job of JOBS) {
    const out = join(ROOT, job.file);
    mkdirSync(dirname(out), { recursive: true });
    await sharp(Buffer.from(job.make(), 'utf8')).png().toFile(out);
    const meta = await sharp(out).metadata();
    const ok = meta.width === job.w && meta.height === job.h ? 'OK  ' : 'SIZE-MISMATCH';
    console.log(`  [${ok}] ${job.file}  (${meta.width}x${meta.height})`);
  }
  for (const [src, dst] of COPIES) {
    const from = join(ROOT, src);
    const to = join(ROOT, dst);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    console.log(`  [COPY] ${src} -> ${dst}`);
  }
  console.log('Done. All images carry a gold "DEMO" ribbon (top-left).');
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
