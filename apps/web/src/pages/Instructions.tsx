import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardContent } from '@brandforge/ui';
import {
  ArrowRight,
  BookOpenText,
  Bot,
  Boxes,
  CheckCircle2,
  Cloud,
  Code2,
  Database,
  ExternalLink,
  FileCode2,
  FolderGit2,
  KeyRound,
  Network,
  PlayCircle,
  Server,
  ShieldCheck,
  Sparkles,
  Workflow,
} from 'lucide-react';

const REPOSITORY_URL = 'https://github.com/jpecinagithub/brandforge';
const ARCHITECTURE_URL = `${REPOSITORY_URL}/blob/main/docs/ARCHITECTURE.md`;
const ADR_URL = `${REPOSITORY_URL}/tree/main/docs/adr`;

const copy = {
  es: {
    eyebrow: 'Guía técnica · BrandForge v1',
    title: 'Instrucciones y arquitectura',
    intro: 'Una referencia práctica para entender el sistema, mantenerlo y retomar el desarrollo sin tener que reconstruir sus decisiones técnicas.',
    repo: 'Abrir repositorio',
    architectureDoc: 'Arquitectura detallada',
    architectureTitle: 'Arquitectura del sistema',
    architectureIntro: 'El navegador solo contiene la capa de presentación. Los datos, secretos y llamadas de IA permanecen en el servidor de Oracle.',
    layers: [
      { title: 'Web en Vercel', body: 'React, TypeScript, Vite y PWA. Gestiona la interfaz, las vistas de campaña y las actualizaciones automáticas.' },
      { title: 'API en Oracle', body: 'Fastify expone REST, autenticación por cookie, permisos, assets y vistas previas de landing.' },
      { title: 'PostgreSQL', body: 'Drizzle ORM, datos de negocio, sesiones, cola duradera, pasos, eventos, auditoría y uso de modelos.' },
      { title: 'Worker agéntico', body: 'Reclama ejecuciones, crea el plan, resuelve dependencias y ejecuta herramientas tipadas con reintentos.' },
      { title: 'OpenRouter y storage', body: 'OpenRouter proporciona inferencia. Los archivos se guardan en un volumen privado del servidor.' },
    ],
    trustTitle: 'Límite de confianza',
    trustBody: 'OPENROUTER_API_KEY, credenciales de base de datos y archivos privados nunca se incorporan al bundle de Vercel ni se entregan al navegador.',
    flowsTitle: 'Flujos desarrollados',
    flowsIntro: 'Estos son los recorridos que forman la versión funcional del producto.',
    flows: [
      { title: '1. Acceso y espacio de trabajo', body: 'Registro o demo → sesión segura → workspace aislado → panel de campañas. Las cuentas demo caducan y no comparten datos.' },
      { title: '2. Creación de campaña', body: 'El usuario define objetivo, briefing, audiencia, entregables y assets de referencia. La API persiste una campaña canónica antes de invocar al agente.' },
      { title: '3. Ejecución del agente', body: 'El mensaje crea un agent_run en PostgreSQL. El worker genera un plan DAG, ejecuta herramientas y guarda cada paso, resultado, coste y evento.' },
      { title: '4. Progreso y recuperación', body: 'La interfaz recibe eventos en directo mediante SSE. Si la conexión se corta, usa polling y restaura la ejecución sin repetir pasos completados.' },
      { title: '5. Entregables', body: 'Brand kit, copy, imágenes, carteles y landing quedan asociados a la campaña. Los assets se previsualizan y descargan; la landing puede publicarse y revocarse.' },
      { title: '6. Operación', body: 'Docker Compose mantiene API, worker y PostgreSQL. Hay health checks, auditoría, pruebas y backup diario restaurable de datos y archivos.' },
    ],
    aiTitle: 'Proveedor y modelos de IA',
    aiIntro: 'La selección de modelo está centralizada y puede cambiar sin modificar la interfaz.',
    providerLabel: 'Proveedor',
    providerValue: 'OpenRouter',
    providerBody: 'Se invoca exclusivamente desde la API y el worker. El frontend nunca llama directamente al proveedor.',
    routingLabel: 'Enrutamiento',
    routingValue: 'Dinámico por capacidad',
    routingBody: 'Prioridad: override por variable de entorno → registro verificado → catálogo vivo de OpenRouter.',
    textLabel: 'Texto, planificación y revisión',
    textValue: 'google/gemini-2.5-flash',
    textBody: 'Modelo observado en las ejecuciones recientes de producción. Cada uso guarda el modelo realmente devuelto.',
    imageLabel: 'Generación de imagen',
    imageValue: 'google/gemini-2.5-flash-image',
    imageBody: 'Modelo observado recientemente. Puede cambiar si se configura un override o cambia la disponibilidad del proveedor.',
    modelNote: 'Consulta el detalle de una ejecución para conocer el modelo efectivo, tokens y coste informados por el proveedor.',
    stackTitle: 'Tecnologías principales',
    stack: [
      'Frontend: React, TypeScript, Vite, Tailwind CSS, React Router y PWA',
      'Backend: Node.js, Fastify, cookies de sesión, Argon2id, RBAC y rate limiting',
      'Datos: PostgreSQL 16, Drizzle ORM y migraciones SQL',
      'Agente: planificador DAG, herramientas Zod, worker duradero, SSE y recuperación por polling',
      'Infraestructura: Vercel, Oracle Cloud, nginx, Docker Compose y volúmenes persistentes',
      'Calidad: Vitest, Playwright, TypeScript y smoke tests contra producción',
    ],
    mapTitle: 'Mapa del repositorio',
    mapIntro: 'Empieza por estas carpetas según la parte que quieras modificar.',
    folders: [
      ['apps/web', 'Interfaz React, rutas, páginas, componentes e idiomas.'],
      ['apps/api', 'API Fastify, autenticación y endpoints de campañas, assets y landings.'],
      ['apps/worker', 'Proceso que reclama y ejecuta trabajos pendientes.'],
      ['packages/agent-core', 'Planificador, orquestador, roles y herramientas del agente.'],
      ['packages/agent-server', 'Adaptadores del agente para base de datos, eventos, memoria y almacenamiento.'],
      ['packages/integrations', 'Cliente de OpenRouter y selección de modelos.'],
      ['packages/database', 'Esquema Drizzle, migraciones y datos demo.'],
      ['infrastructure', 'Docker Compose, nginx y automatización de backups.'],
      ['tests', 'Pruebas E2E y documentación de la estrategia de validación.'],
    ],
    resumeTitle: 'Cómo retomar el proyecto',
    resumeIntro: 'Orden recomendado para una nueva sesión de desarrollo.',
    resumeSteps: [
      'Lee README.md, docs/ARCHITECTURE.md y los ADR para entender las decisiones ya tomadas.',
      'Copia .env.example a .env y configura Postgres y OpenRouter sin exponer secretos en variables VITE_*.',
      'Instala dependencias con npm ci y levanta PostgreSQL, API y worker mediante Docker Compose.',
      'Aplica migraciones antes de probar cambios que modifiquen el esquema de datos.',
      'Ejecuta typecheck, pruebas unitarias y el recorrido E2E afectado antes de desplegar.',
      'El frontend se despliega en Vercel; API y worker se reconstruyen en Oracle. Verifica siempre navegador → API → datos → respuesta.',
    ],
    commandsTitle: 'Arranque local mínimo',
    commands: ['npm ci', 'cp .env.example .env', 'docker compose -f infrastructure/docker/docker-compose.yml up -d --build', 'npm run db:migrate', 'npm run dev --workspace=@brandforge/web'],
    docsTitle: 'Documentación esencial',
    docsBody: 'Los ADR explican por qué se eligieron PostgreSQL como cola, OpenRouter, el modelo de seguridad, la demo aislada y la ejecución duradera.',
    adr: 'Ver decisiones de arquitectura',
    cautionTitle: 'Antes de cambiar el agente',
    cautionBody: 'Mantén las herramientas tipadas, evita pasar IDs como contenido, registra cada uso de modelo y conserva la recuperación idempotente. Una ejecución debe poder reanudarse sin duplicar entregables.',
  },
  en: {
    eyebrow: 'Technical guide · BrandForge v1',
    title: 'Instructions and architecture',
    intro: 'A practical reference for understanding, maintaining and resuming development without reconstructing the project’s technical decisions.',
    repo: 'Open repository',
    architectureDoc: 'Detailed architecture',
    architectureTitle: 'System architecture',
    architectureIntro: 'The browser only contains the presentation layer. Data, secrets and AI calls remain on the Oracle server.',
    layers: [
      { title: 'Web on Vercel', body: 'React, TypeScript, Vite and PWA. It manages the UI, campaign views and automatic updates.' },
      { title: 'API on Oracle', body: 'Fastify exposes REST, cookie authentication, permissions, assets and landing previews.' },
      { title: 'PostgreSQL', body: 'Drizzle ORM, business data, sessions, durable queue, steps, events, audit and model usage.' },
      { title: 'Agent worker', body: 'Claims runs, creates the plan, resolves dependencies and executes typed tools with retries.' },
      { title: 'OpenRouter and storage', body: 'OpenRouter provides inference. Files are stored in a private server volume.' },
    ],
    trustTitle: 'Trust boundary',
    trustBody: 'OPENROUTER_API_KEY, database credentials and private files are never bundled by Vercel or delivered to the browser.',
    flowsTitle: 'Implemented flows',
    flowsIntro: 'These journeys make up the functional product version.',
    flows: [
      { title: '1. Access and workspace', body: 'Registration or demo → secure session → isolated workspace → campaign dashboard. Demo accounts expire and never share data.' },
      { title: '2. Campaign creation', body: 'The user defines objective, brief, audience, deliverables and reference assets. The API persists one canonical campaign before invoking the agent.' },
      { title: '3. Agent execution', body: 'A message creates an agent_run in PostgreSQL. The worker builds a DAG plan, runs tools and stores every step, result, cost and event.' },
      { title: '4. Progress and recovery', body: 'The UI receives live SSE events. If the connection drops, polling restores the run without repeating completed steps.' },
      { title: '5. Deliverables', body: 'Brand kit, copy, images, posters and landing pages remain attached to the campaign. Assets can be previewed and downloaded; landings can be published and revoked.' },
      { title: '6. Operations', body: 'Docker Compose keeps API, worker and PostgreSQL running. Health checks, audit, tests and daily restorable data/file backups are included.' },
    ],
    aiTitle: 'AI provider and models',
    aiIntro: 'Model selection is centralized and can change without modifying the interface.',
    providerLabel: 'Provider', providerValue: 'OpenRouter', providerBody: 'Called only by the API and worker. The frontend never talks directly to the provider.',
    routingLabel: 'Routing', routingValue: 'Dynamic by capability', routingBody: 'Priority: environment override → verified registry → live OpenRouter catalog.',
    textLabel: 'Text, planning and review', textValue: 'google/gemini-2.5-flash', textBody: 'Observed in recent production runs. Every usage records the model actually returned.',
    imageLabel: 'Image generation', imageValue: 'google/gemini-2.5-flash-image', imageBody: 'Recently observed model. It may change when an override is configured or provider availability changes.',
    modelNote: 'Open a run detail to see the effective model, tokens and provider-reported cost.',
    stackTitle: 'Core technologies',
    stack: [
      'Frontend: React, TypeScript, Vite, Tailwind CSS, React Router and PWA',
      'Backend: Node.js, Fastify, session cookies, Argon2id, RBAC and rate limiting',
      'Data: PostgreSQL 16, Drizzle ORM and SQL migrations',
      'Agent: DAG planner, Zod tools, durable worker, SSE and polling recovery',
      'Infrastructure: Vercel, Oracle Cloud, nginx, Docker Compose and persistent volumes',
      'Quality: Vitest, Playwright, TypeScript and production smoke tests',
    ],
    mapTitle: 'Repository map', mapIntro: 'Start with these folders depending on the part you need to change.',
    folders: [
      ['apps/web', 'React interface, routes, pages, components and languages.'],
      ['apps/api', 'Fastify API, authentication and campaign, asset and landing endpoints.'],
      ['apps/worker', 'Process that claims and executes pending jobs.'],
      ['packages/agent-core', 'Agent planner, orchestrator, roles and tools.'],
      ['packages/agent-server', 'Agent adapters for database, events, memory and storage.'],
      ['packages/integrations', 'OpenRouter client and model selection.'],
      ['packages/database', 'Drizzle schema, migrations and demo data.'],
      ['infrastructure', 'Docker Compose, nginx and backup automation.'],
      ['tests', 'E2E tests and validation strategy documentation.'],
    ],
    resumeTitle: 'How to resume the project', resumeIntro: 'Recommended order for a new development session.',
    resumeSteps: [
      'Read README.md, docs/ARCHITECTURE.md and the ADRs to understand existing decisions.',
      'Copy .env.example to .env and configure Postgres and OpenRouter without exposing secrets in VITE_* variables.',
      'Install dependencies with npm ci and start PostgreSQL, API and worker with Docker Compose.',
      'Apply migrations before testing changes that modify the data schema.',
      'Run typecheck, unit tests and the affected E2E journey before deployment.',
      'The frontend deploys to Vercel; API and worker are rebuilt on Oracle. Always verify browser → API → data → response.',
    ],
    commandsTitle: 'Minimum local startup',
    commands: ['npm ci', 'cp .env.example .env', 'docker compose -f infrastructure/docker/docker-compose.yml up -d --build', 'npm run db:migrate', 'npm run dev --workspace=@brandforge/web'],
    docsTitle: 'Essential documentation',
    docsBody: 'The ADRs explain the PostgreSQL queue, OpenRouter, security model, isolated demo and durable execution choices.',
    adr: 'View architecture decisions',
    cautionTitle: 'Before changing the agent',
    cautionBody: 'Keep tools typed, never pass IDs as content, record each model usage and preserve idempotent recovery. A run must resume without duplicating deliverables.',
  },
} as const;

const layerIcons: ReactNode[] = [<Cloud size={19} />, <Server size={19} />, <Database size={19} />, <Bot size={19} />, <Sparkles size={19} />];

function SectionHeading({ id, icon, title, description }: { id?: string; icon: ReactNode; title: string; description?: string }) {
  return (
    <div className="mb-5 flex items-start gap-3">
      <div className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">{icon}</div>
      <div>
        <h2 id={id} className="text-xl font-bold tracking-tight text-slate-950 dark:text-white">{title}</h2>
        {description ? <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">{description}</p> : null}
      </div>
    </div>
  );
}

function ExternalButton({ href, children, primary = false }: { href: string; children: ReactNode; primary?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${primary ? 'bg-violet-600 text-white shadow-lg shadow-violet-600/20 hover:bg-violet-700' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'}`}
    >
      {children}
      <ExternalLink size={15} aria-hidden="true" />
    </a>
  );
}

export function Instructions() {
  const { i18n } = useTranslation();
  const content = i18n.resolvedLanguage?.startsWith('es') ? copy.es : copy.en;

  return (
    <div className="space-y-8 pb-10">
      <section className="relative overflow-hidden rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-sky-50 p-6 sm:p-8 dark:border-violet-500/20 dark:from-violet-950/40 dark:via-slate-900 dark:to-sky-950/30">
        <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full bg-violet-300/25 blur-3xl dark:bg-violet-500/10" />
        <div className="relative max-w-4xl">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-violet-700 dark:border-violet-500/30 dark:bg-slate-900/60 dark:text-violet-300">
            <BookOpenText size={14} aria-hidden="true" />
            {content.eyebrow}
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl dark:text-white">{content.title}</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-600 dark:text-slate-300">{content.intro}</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <ExternalButton href={REPOSITORY_URL} primary><FolderGit2 size={16} aria-hidden="true" />{content.repo}</ExternalButton>
            <ExternalButton href={ARCHITECTURE_URL}><Network size={16} aria-hidden="true" />{content.architectureDoc}</ExternalButton>
          </div>
        </div>
      </section>

      <section aria-labelledby="architecture-heading">
        <SectionHeading id="architecture-heading" icon={<Boxes size={20} />} title={content.architectureTitle} description={content.architectureIntro} />
        <div className="grid gap-3 xl:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr_auto_1fr] xl:items-stretch">
          {content.layers.map((layer, index) => (
            <div className="contents" key={layer.title}>
              <Card className="h-full">
                <CardContent className="flex h-full flex-col gap-3 p-4">
                  <div className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-violet-700 dark:bg-slate-800 dark:text-violet-300">{layerIcons[index]}</div>
                  <h3 className="font-semibold text-slate-950 dark:text-white">{layer.title}</h3>
                  <p className="text-sm leading-6 text-slate-600 dark:text-slate-400">{layer.body}</p>
                </CardContent>
              </Card>
              {index < content.layers.length - 1 ? <ArrowRight className="hidden self-center text-slate-300 xl:block dark:text-slate-700" size={18} aria-hidden="true" /> : null}
            </div>
          ))}
        </div>
        <div className="mt-4 flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-100">
          <ShieldCheck className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-300" size={20} aria-hidden="true" />
          <div><p className="font-semibold">{content.trustTitle}</p><p className="mt-1 text-sm leading-6 opacity-80">{content.trustBody}</p></div>
        </div>
      </section>

      <section aria-labelledby="flows-heading">
        <SectionHeading id="flows-heading" icon={<Workflow size={20} />} title={content.flowsTitle} description={content.flowsIntro} />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {content.flows.map((flow) => (
            <Card key={flow.title} className="h-full">
              <CardContent className="p-5">
                <h3 className="font-semibold text-slate-950 dark:text-white">{flow.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{flow.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="ai-heading">
        <SectionHeading id="ai-heading" icon={<Sparkles size={20} />} title={content.aiTitle} description={content.aiIntro} />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            [content.providerLabel, content.providerValue, content.providerBody, <Cloud size={19} />],
            [content.routingLabel, content.routingValue, content.routingBody, <Network size={19} />],
            [content.textLabel, content.textValue, content.textBody, <Code2 size={19} />],
            [content.imageLabel, content.imageValue, content.imageBody, <Sparkles size={19} />],
          ].map(([label, value, body, icon]) => (
            <Card key={String(label)}>
              <CardContent className="p-5">
                <div className="mb-4 grid h-9 w-9 place-items-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">{icon}</div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</p>
                <p className="mt-1 break-words font-semibold text-slate-950 dark:text-white">{value}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
        <p className="mt-3 flex items-start gap-2 text-sm text-slate-500 dark:text-slate-400"><CheckCircle2 className="mt-0.5 shrink-0 text-emerald-500" size={16} aria-hidden="true" />{content.modelNote}</p>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section aria-labelledby="stack-heading">
          <SectionHeading id="stack-heading" icon={<Code2 size={20} />} title={content.stackTitle} />
          <Card><CardContent className="space-y-3 p-5">
            {content.stack.map((item) => <p key={item} className="flex gap-3 text-sm leading-6 text-slate-600 dark:text-slate-300"><CheckCircle2 className="mt-1 shrink-0 text-emerald-500" size={16} aria-hidden="true" />{item}</p>)}
          </CardContent></Card>
        </section>

        <section aria-labelledby="map-heading">
          <SectionHeading id="map-heading" icon={<FolderGit2 size={20} />} title={content.mapTitle} description={content.mapIntro} />
          <Card><CardContent className="divide-y divide-slate-100 p-0 dark:divide-slate-800">
            {content.folders.map(([folder, description]) => (
              <div key={folder} className="grid gap-1 px-5 py-3 sm:grid-cols-[150px_1fr] sm:gap-4">
                <code className="text-sm font-semibold text-violet-700 dark:text-violet-300">{folder}</code>
                <p className="text-sm leading-5 text-slate-600 dark:text-slate-400">{description}</p>
              </div>
            ))}
          </CardContent></Card>
        </section>
      </div>

      <section aria-labelledby="resume-heading">
        <SectionHeading id="resume-heading" icon={<PlayCircle size={20} />} title={content.resumeTitle} description={content.resumeIntro} />
        <div className="grid gap-6 xl:grid-cols-[1.15fr_.85fr]">
          <Card><CardContent className="space-y-4 p-5">
            {content.resumeSteps.map((step, index) => (
              <div key={step} className="flex gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-violet-100 text-xs font-bold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">{index + 1}</span>
                <p className="pt-0.5 text-sm leading-6 text-slate-600 dark:text-slate-300">{step}</p>
              </div>
            ))}
          </CardContent></Card>
          <Card className="overflow-hidden">
            <div className="border-b border-slate-800 bg-slate-950 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">{content.commandsTitle}</div>
            <CardContent className="space-y-2 bg-slate-950 p-5">
              {content.commands.map((command) => <code key={command} className="block overflow-x-auto whitespace-nowrap rounded-lg bg-slate-900 px-3 py-2 text-xs text-emerald-300">$ {command}</code>)}
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-start gap-3"><FileCode2 className="mt-0.5 shrink-0 text-sky-500" size={21} aria-hidden="true" /><div><h2 className="font-semibold text-slate-950 dark:text-white">{content.docsTitle}</h2><p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{content.docsBody}</p><a href={ADR_URL} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-violet-700 hover:text-violet-800 dark:text-violet-300">{content.adr}<ExternalLink size={14} aria-hidden="true" /></a></div></div>
          </CardContent>
        </Card>
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/10">
          <CardContent className="p-5">
            <div className="flex items-start gap-3"><KeyRound className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" size={21} aria-hidden="true" /><div><h2 className="font-semibold text-amber-950 dark:text-amber-100">{content.cautionTitle}</h2><p className="mt-2 text-sm leading-6 text-amber-900/75 dark:text-amber-100/75">{content.cautionBody}</p></div></div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
