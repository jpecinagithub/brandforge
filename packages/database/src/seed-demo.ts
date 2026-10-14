/**
 * Shared demo-content seeder.
 *
 * Used by BOTH:
 *  - `npm run db:seed` (dev seed for demo@brandforge.local), and
 *  - POST /api/v1/auth/demo in apps/api (per-demo-user isolated workspace).
 *
 * The API's storage adapter is injected via `StorageWriter` so this package
 * never touches the filesystem layout directly.
 */
import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, and } from 'drizzle-orm';
import {
  assets,
  brandKits,
  campaigns,
  conversations,
  landingPages,
  messages,
  projects,
} from './schema.js';
import type { Db } from './db.js';

export interface StorageWriter {
  /** Persist bytes at a path relative to STORAGE_PATH, e.g. `assets/<uuid>.png`. */
  writeFile(relativePath: string, data: Buffer): Promise<void>;
}

const DEMO_PROJECT_NAME = 'Café Aroma — Christmas Campaign';
const DEMO_CONVERSATION_TITLE = 'Welcome to BrandForge';

function seedAssetsDir(): string {
  // Resolve relative to this module (src/ or dist/), never process.cwd():
  // the API serves demo sessions from apps/api, the seed CLI from packages/database.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', 'seed-assets');
}

/** Minimal PNG dimension sniff (IHDR), enough for demo rows. Returns null when unknown. */
function pngDimensions(buf: Buffer): { width: number; height: number } | null {
  try {
    if (buf.length < 24) return null;
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    if (!buf.subarray(0, 8).equals(sig)) return null;
    return {
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
    };
  } catch {
    return null;
  }
}

export interface SeedDemoResult {
  projectId: string;
  campaignId: string;
  brandKitId: string;
  landingPageId: string;
  conversationId: string;
  assetsCreated: number;
}

/**
 * Seeds demo content into an EXISTING workspace for an EXISTING user.
 * Idempotent per workspace: if the demo project already exists, it is reused
 * and only missing pieces are created.
 */
export async function seedDemoContent(
  db: Db,
  storage: StorageWriter,
  workspaceId: string,
  _userId: string,
): Promise<SeedDemoResult> {
  let projectRows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.workspaceId, workspaceId), eq(projects.name, DEMO_PROJECT_NAME)))
    .limit(1);

  let projectId: string;
  if (projectRows.length > 0) {
    projectId = projectRows[0].id;
  } else {
    const [p] = await db
      .insert(projects)
      .values({
        workspaceId,
        name: DEMO_PROJECT_NAME,
        description:
          'A festive brand and campaign concept for Café Aroma, a specialty coffee house in Bilbao. Showcases elegant Christmas branding across digital and print touchpoints.',
      })
      .returning();
    projectId = p.id;
    projectRows = [p];
  }

  // A real, renderable landing page makes the demo useful before the user
  // spends any AI credits. Agent-created pages use the same schema.
  const existingLandingPages = await db
    .select()
    .from(landingPages)
    .where(eq(landingPages.projectId, projectId))
    .limit(1);
  let landingPageId: string;
  if (existingLandingPages.length > 0) {
    landingPageId = existingLandingPages[0].id;
  } else {
    const [landing] = await db
      .insert(landingPages)
      .values({
        projectId,
        name: 'Navidad en cada taza',
        schema: {
          kind: 'landing_page',
          template: 'hero',
          headline: 'Magia de Navidad en cada taza',
          subheadline:
            'Café Aroma, Bilbao — bebidas de temporada, villancicos en directo y una mesa cálida durante todo diciembre.',
          cta: 'Ver el menú de Navidad',
          sections: [
            {
              heading: '2×1 en capuchinos',
              body: 'Todo diciembre, todas las tardes. Porque los días fríos se disfrutan mejor en compañía.',
            },
            {
              heading: 'Turrón Latte',
              body: 'Turrón, espresso y leche vaporizada bajo un delicado toque de canela.',
            },
            {
              heading: 'Villancicos en directo',
              body: 'Una tarde de música y barrio con entrada libre el 21 de diciembre.',
            },
          ],
          version: 1,
        },
      })
      .returning();
    landingPageId = landing.id;
  }

  // Brand kit (upsert by project)
  const existingKit = await db
    .select()
    .from(brandKits)
    .where(eq(brandKits.projectId, projectId))
    .limit(1);
  let brandKitId: string;
  if (existingKit.length > 0) {
    brandKitId = existingKit[0].id;
  } else {
    const [kit] = await db
      .insert(brandKits)
      .values({
        projectId,
        brandName: 'Café Aroma',
        tagline: 'Christmas in every cup',
        description:
          'A specialty coffee house in Bilbao. For Christmas 2026 the brand leans into warm, elegant holiday storytelling: deep greens, champagne gold and cream paper textures.',
        colors: ['#1E3D2F', '#C9A227', '#F7F3EA'],
        fonts: ['Fraunces', 'Inter'],
        tone: 'Warm, elegant, unhurried. Speaks like a friend who knows good coffee.',
        audience: 'Coffee lovers in Bilbao aged 25–55; gift buyers during the holiday season.',
      })
      .returning();
    brandKitId = kit.id;
  }

  // Campaign with demo copy (EN + ES)
  const existingCampaigns = await db
    .select()
    .from(campaigns)
    .where(eq(campaigns.projectId, projectId))
    .limit(1);
  let campaignId: string;
  if (existingCampaigns.length > 0) {
    campaignId = existingCampaigns[0].id;
  } else {
    const [c] = await db
      .insert(campaigns)
      .values({
        projectId,
        name: 'Christmas 2026 Launch',
        objective:
          'EN: Drive holiday footfall and gift-card sales with a cozy, premium Christmas campaign.\n' +
          'ES: Aumentar el tráfico en tienda y la venta de tarjetas regalo con una campaña navideña acogedora y premium.',
        status: 'draft',
      })
      .returning();
    campaignId = c.id;
  }

  // Welcome conversation (2 messages, honest — no AI involved)
  const existingConversations = await db
    .select()
    .from(conversations)
    .where(eq(conversations.projectId, projectId))
    .limit(1);
  let conversationId: string;
  if (existingConversations.length > 0) {
    conversationId = existingConversations[0].id;
  } else {
    const [conv] = await db
      .insert(conversations)
      .values({ projectId, title: DEMO_CONVERSATION_TITLE })
      .returning();
    conversationId = conv.id;
    await db.insert(messages).values([
      {
        conversationId,
        role: 'assistant',
        content:
          'Bienvenido a BrandForge. Este espacio incluye una campaña completa de Café Aroma, su identidad, recursos y una landing lista para previsualizar. Pídeme una nueva propuesta y podrás seguir cada paso de la ejecución.',
      },
      {
        conversationId,
        role: 'user',
        content: 'Perfecto. Primero quiero explorar la identidad y la landing de ejemplo.',
      },
    ]);
  }

  // Seed assets from packages/database/seed-assets/*.png (optional)
  let assetsCreated = 0;
  const dir = seedAssetsDir();
  let files: string[] = [];
  try {
    files = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith('.png'));
  } catch {
    // directory missing — warn once below
  }
  if (files.length === 0) {
    console.warn(
      `[seed] WARNING: no *.png files found in ${dir}. ` +
        'Demo assets were skipped — the PNGs are provided by a sibling agent and ' +
        'will be picked up automatically the next time the seed runs.',
    );
    return { projectId, campaignId, brandKitId, landingPageId, conversationId, assetsCreated };
  }
  const existingAssets = await db
    .select()
    .from(assets)
    .where(and(eq(assets.projectId, projectId), eq(assets.isDemo, true)));
  const knownNames = new Set(existingAssets.map((a) => a.originalName));
  for (const file of files.sort()) {
    if (knownNames.has(file)) continue;
    const buf = await readFile(path.join(dir, file));
    const id = randomUUID();
    const relPath = `assets/${id}.png`;
    await storage.writeFile(relPath, buf);
    const dims = pngDimensions(buf);
    await db.insert(assets).values({
      workspaceId,
      projectId,
      filename: `${id}.png`,
      originalName: file,
      mime: 'image/png',
      sizeBytes: buf.length,
      kind: 'image',
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      isDemo: true,
    });
    assetsCreated += 1;
  }
  console.log(`[seed] Seeded ${assetsCreated} demo asset(s) from seed-assets/.`);

  return { projectId, campaignId, brandKitId, landingPageId, conversationId, assetsCreated };
}
