import type { Appearance } from '@stripe/stripe-js';

function isDark(root: HTMLElement): boolean {
  const attr = root.getAttribute('data-theme');
  if (attr === 'dark') return true;
  if (attr === 'light') return false;
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Stripe cannot read CSS variables, so hand it the computed token values. */
export function stripeAppearance(): Appearance {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const v = (name: string) => style.getPropertyValue(name).trim();
  return {
    theme: isDark(root) ? 'night' : 'stripe',
    variables: {
      colorPrimary: v('--primary'),
      colorBackground: v('--bg-surface'),
      colorText: v('--text-default'),
      colorTextSecondary: v('--text-muted'),
      colorDanger: v('--danger'),
      borderRadius: v('--radius-md'),
      fontFamily: v('--font-sans'),
    },
    rules: { '.Input': { borderColor: v('--border-default') } },
  };
}
