interface AvatarProps {
  name: string;
  src?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizes: Record<string, string> = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-16 w-16 text-xl',
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({ name, src, size = 'md', className = '' }: AvatarProps) {
  const cls = `flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-600 font-semibold text-white ring-2 ring-white/20 ${sizes[size]} ${className}`;
  if (src) {
    return <img src={src} alt={name} className={cls + ' object-cover'} />;
  }
  return (
    <div className={cls} aria-label={name}>
      {initials(name)}
    </div>
  );
}
