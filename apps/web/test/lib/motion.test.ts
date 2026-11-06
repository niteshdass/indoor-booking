import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrollBehavior } from '../../src/lib/motion';

const media = (reduce: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: reduce && q.includes('reduce'), media: q }) as MediaQueryList);

afterEach(() => vi.unstubAllGlobals());

describe('scrollBehavior', () => {
  it('scrolls smoothly by default', () => {
    media(false);
    expect(scrollBehavior()).toBe('smooth');
  });

  it('jumps when the system asks for less motion', () => {
    media(true);
    expect(scrollBehavior()).toBe('auto');
  });
});
