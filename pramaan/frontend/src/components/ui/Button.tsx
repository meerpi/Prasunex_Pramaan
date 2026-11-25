import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'btn-primary-tactile bg-action text-surface border border-action hover:bg-action-hover hover:border-action-hover',
  secondary:
    'btn-secondary-tactile bg-surface text-ink border border-rule hover:bg-subtle hover:border-ink/30',
  ghost:
    'bg-transparent text-ink-secondary border border-transparent hover:bg-subtle hover:text-ink',
  danger:
    'btn-secondary-tactile bg-blocker-bg text-blocker border border-blocker-border hover:bg-blocker-bg-hover',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: 'min-h-11 lg:min-h-9 px-3.5 py-2 text-sm gap-2',
  sm: 'min-h-11 lg:min-h-8 px-2.5 py-1.5 text-xs gap-1.5',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

/** Unified institutional action button primitive (strictly 4 variants across the app). */
export function Button({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`btn-interactive inline-flex max-w-full items-center justify-center rounded font-semibold leading-snug text-center whitespace-normal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action disabled:cursor-not-allowed disabled:opacity-45 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
