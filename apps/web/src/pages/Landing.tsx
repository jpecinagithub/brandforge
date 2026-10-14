import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardContent, Badge } from '@brandforge/ui';
import {
  Sparkles, Palette, FolderKanban, ImagePlus, Zap, ShieldCheck,
  ArrowRight, MessageSquareText, Check, FlaskConical,
} from 'lucide-react';
import { Navbar } from '@/components/Navbar';
import { Footer } from '@/components/Footer';
import { useAuth } from '@/context/AuthContext';

function FeatureCard({ icon, title, desc, delay }: { icon: React.ReactNode; title: string; desc: string; delay: number }) {
  return (
    <Card className="animate-rise p-6 transition-transform hover:-translate-y-1" style={{ animationDelay: `${delay}ms` }}>
      <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
        {icon}
      </div>
      <h3 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{desc}</p>
    </Card>
  );
}

/** Static illustrative mock of the agent workspace — built with divs only. */
function WorkspaceMock() {
  const { t } = useTranslation();
  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-violet-600/10 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center gap-1.5 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-emerald-400" />
        <span className="ml-3 rounded-md bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          brandforge.ai/app
        </span>
      </div>
      <div className="grid md:grid-cols-[1fr_220px]">
        <div className="space-y-3 p-4 sm:p-5">
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-br-md bg-violet-600 px-4 py-2.5 text-sm text-white">
              {t('landing.chatBubble1')}
            </div>
          </div>
          <div className="flex justify-start">
            <div className="flex max-w-[85%] items-start gap-2.5 rounded-2xl rounded-bl-md bg-slate-100 px-4 py-2.5 text-sm text-slate-700 dark:bg-slate-800 dark:text-slate-200">
              <Sparkles size={15} className="mt-0.5 shrink-0 text-violet-500" />
              {t('landing.chatBubble2')}
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            {['#7C3AED', '#F59E0B', '#0F172A'].map((c) => (
              <span key={c} className="h-8 w-8 rounded-lg shadow-inner" style={{ backgroundColor: c }} />
            ))}
            <div className="flex h-8 items-center rounded-lg bg-slate-100 px-3 text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              Aa — Inter
            </div>
          </div>
        </div>
        <div className="hidden border-l border-slate-100 p-4 md:block dark:border-slate-800">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Campaigns</p>
          <div className="space-y-2">
            {['Christmas Coffee', 'SaaS Launch', 'Restaurant Opening'].map((name, i) => (
              <div key={name} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-2 text-xs font-medium text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                <span className={`h-2 w-2 rounded-full ${i === 0 ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                {name}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="border-t border-dashed border-slate-200 px-4 py-2.5 text-center text-[11px] text-slate-400 dark:border-slate-700 dark:text-slate-500">
        {t('landing.illustrativeNote')}
      </div>
    </div>
  );
}

const examples = [
  { key: 'example1', img: '/demo/hero-navidad.png', gradient: 'from-amber-500 to-red-600' },
  { key: 'example2', img: '/demo/post-instagram-1.png', gradient: 'from-violet-600 to-fuchsia-600' },
  { key: 'example3', img: null as string | null, gradient: 'from-sky-500 to-emerald-500' },
];

export function Landing() {
  const { t } = useTranslation();
  const { startDemo } = useAuth();
  const navigate = useNavigate();
  const [demoLoading, setDemoLoading] = useState(false);

  const handleDemo = async () => {
    setDemoLoading(true);
    try {
      await startDemo();
      navigate('/app');
    } catch {
      navigate('/login');
    } finally {
      setDemoLoading(false);
    }
  };

  const features = [
    { icon: <MessageSquareText size={20} />, title: t('landing.feature1Title'), desc: t('landing.feature1Desc') },
    { icon: <Palette size={20} />, title: t('landing.feature2Title'), desc: t('landing.feature2Desc') },
    { icon: <FolderKanban size={20} />, title: t('landing.feature3Title'), desc: t('landing.feature3Desc') },
    { icon: <ImagePlus size={20} />, title: t('landing.feature4Title'), desc: t('landing.feature4Desc') },
    { icon: <Zap size={20} />, title: t('landing.feature5Title'), desc: t('landing.feature5Desc') },
    { icon: <ShieldCheck size={20} />, title: t('landing.feature6Title'), desc: t('landing.feature6Desc') },
  ];

  const plans = [
    { name: t('landing.planDemoName'), price: t('landing.planDemoPrice'), desc: t('landing.planDemoDesc'), features: [t('landing.planDemoF1'), t('landing.planDemoF2'), t('landing.planDemoF3')], cta: t('nav.tryDemo'), highlight: false, onClick: handleDemo },
    { name: t('landing.planFreeName'), price: t('landing.planFreePrice'), desc: t('landing.planFreeDesc'), features: [t('landing.planFreeF1'), t('landing.planFreeF2'), t('landing.planFreeF3')], cta: t('nav.startCreating'), highlight: true, to: '/register' },
    { name: t('landing.planProName'), price: t('landing.planProPrice'), period: t('landing.planProPeriod'), desc: t('landing.planProDesc'), features: [t('landing.planProF1'), t('landing.planProF2'), t('landing.planProF3')], cta: t('landing.choosePlan'), highlight: false, to: '/register' },
  ];

  return (
    <div className="min-h-screen bg-white text-slate-900 dark:bg-slate-950 dark:text-white">
      <Navbar />

      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-violet-100/80 via-transparent to-transparent dark:from-violet-950/40" aria-hidden="true" />
        <div className="pointer-events-none absolute -top-32 left-1/2 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-violet-400/20 blur-3xl dark:bg-violet-600/20" aria-hidden="true" />
        <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-16 text-center sm:px-6 sm:pt-24">
          <Badge tone="violet" className="mb-6 px-3 py-1.5 text-xs">
            <Sparkles size={13} aria-hidden="true" />
            {t('landing.badge')}
          </Badge>
          <h1 className="mx-auto max-w-3xl text-4xl font-extrabold tracking-tight sm:text-6xl">
            {t('landing.heroTitle')}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-600 dark:text-slate-300">
            {t('landing.heroSubtitle')}
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link to="/register">
              <Button size="lg" icon={<ArrowRight size={18} />}>{t('landing.ctaPrimary')}</Button>
            </Link>
            <Button size="lg" variant="secondary" icon={<FlaskConical size={18} />} loading={demoLoading} onClick={handleDemo}>
              {t('landing.ctaSecondary')}
            </Button>
          </div>

          <div className="mx-auto mt-14 max-w-4xl text-left">
            <WorkspaceMock />
          </div>
        </div>
      </section>

      {/* DEMO VISUAL */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight">{t('landing.demoVisualTitle')}</h2>
          <p className="mx-auto mt-3 max-w-2xl text-slate-600 dark:text-slate-300">{t('landing.demoVisualSubtitle')}</p>
        </div>
      </section>

      {/* FEATURES */}
      <section id="features" className="border-y border-slate-100 bg-slate-50/60 py-16 dark:border-slate-800 dark:bg-slate-900/40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight">{t('landing.featuresTitle')}</h2>
            <p className="mx-auto mt-3 max-w-2xl text-slate-600 dark:text-slate-300">{t('landing.featuresSubtitle')}</p>
          </div>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => (
              <FeatureCard key={f.title} icon={f.icon} title={f.title} desc={f.desc} delay={i * 60} />
            ))}
          </div>
        </div>
      </section>

      {/* EXAMPLES */}
      <section id="examples" className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="text-center">
          <h2 className="text-3xl font-bold tracking-tight">{t('landing.examplesTitle')}</h2>
          <p className="mx-auto mt-3 max-w-2xl text-slate-600 dark:text-slate-300">{t('landing.examplesSubtitle')}</p>
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-3">
          {examples.map((ex) => (
            <Card key={ex.key} className="animate-rise overflow-hidden transition-transform hover:-translate-y-1">
              <div className={`relative h-44 bg-gradient-to-br ${ex.gradient}`}>
                {ex.img && <img src={ex.img} alt={t(`landing.${ex.key}Title`)} className="h-full w-full object-cover" loading="lazy" />}
              </div>
              <CardContent>
                <h3 className="font-semibold text-slate-900 dark:text-white">{t(`landing.${ex.key}Title`)}</h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{t(`landing.${ex.key}Desc`)}</p>
                <button onClick={handleDemo} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-violet-600 hover:text-violet-500 dark:text-violet-400">
                  {t('landing.viewExample')} <ArrowRight size={15} />
                </button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="border-t border-slate-100 bg-slate-50/60 py-16 dark:border-slate-800 dark:bg-slate-900/40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="text-center">
            <h2 className="text-3xl font-bold tracking-tight">{t('landing.pricingTitle')}</h2>
            <p className="mx-auto mt-3 max-w-2xl text-slate-600 dark:text-slate-300">{t('landing.pricingSubtitle')}</p>
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {plans.map((plan) => (
              <Card key={plan.name} className={`relative flex flex-col p-6 ${plan.highlight ? 'border-violet-500/50 shadow-xl shadow-violet-600/10 dark:border-violet-500/40' : ''}`}>
                <Badge tone="amber" className="absolute right-4 top-4">{t('common.comingSoon')}</Badge>
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{plan.name}</h3>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{plan.desc}</p>
                <p className="mt-4 text-4xl font-extrabold text-slate-900 dark:text-white">
                  {plan.price}
                  {plan.period && <span className="text-base font-medium text-slate-500">{plan.period}</span>}
                </p>
                <ul className="mt-5 flex-1 space-y-2.5">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
                      <Check size={16} className="mt-0.5 shrink-0 text-emerald-500" /> {f}
                    </li>
                  ))}
                </ul>
                <div className="mt-6">
                  {plan.to ? (
                    <Link to={plan.to} className="block"><Button variant={plan.highlight ? 'primary' : 'secondary'} className="w-full">{plan.cta}</Button></Link>
                  ) : (
                    <Button variant="secondary" className="w-full" onClick={plan.onClick}>{plan.cta}</Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
