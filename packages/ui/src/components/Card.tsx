import { HTMLAttributes, ReactNode } from 'react';

export function Card({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}
      {...rest}
    />
  );
}

export function CardHeader({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`p-5 pb-0 ${className}`} {...rest} />;
}

export function CardTitle({ className = '', ...rest }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3 className={`text-base font-semibold text-slate-900 dark:text-white ${className}`} {...rest} />
  );
}

export function CardDescription({ className = '', ...rest }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={`mt-1 text-sm text-slate-500 dark:text-slate-400 ${className}`} {...rest} />;
}

export function CardContent({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`p-5 ${className}`} {...rest} />;
}

export function CardFooter({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`flex items-center justify-end gap-2 border-t border-slate-100 p-5 pt-4 dark:border-slate-800 ${className}`}
      {...rest}
    />
  );
}

export function CardIcon({ children, tone = 'violet' }: { children: ReactNode; tone?: 'violet' | 'amber' | 'emerald' | 'sky' }) {
  const tones: Record<string, string> = {
    violet: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
    emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
    sky: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  };
  return (
    <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${tones[tone]}`}>{children}</div>
  );
}
