import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dark, light, tokenNames } from '../../src/theme/tokens';

const css = readFileSync(join(__dirname, '../../../web/src/styles/tokens.css'), 'utf8');

/** Every `--name:` declared in the :root block and in the dark blocks. */
const declared = [...new Set([...css.matchAll(/^\s*--([\w-]+)\s*:/gm)].map((m) => m[1]!))];

describe('design tokens', () => {
  it('lists every token declared in tokens.css', () => {
    expect(declared.length).toBeGreaterThan(100);
    expect(declared.filter((n) => !tokenNames.includes(n))).toEqual([]);
  });

  it('carries the design-system page backgrounds', () => {
    expect(light.bgPage).toBe('#fbfbfa');
    expect(dark.bgPage).toBe('#0f1317');
  });

  it('makes ball yellow the dark primary', () => {
    expect(dark.primary).toBe('#d6ef3f');
    expect(light.primary).toBe('#232a35');
  });

  it('converts px and rem to numbers and none to null', () => {
    expect(light.space2).toBe(8);
    expect(light.controlLg).toBe(44);
    expect(light.tableRow).toBe(60);
    expect(light.shadowSm).toBeNull();
  });

  it('resolves var() references', () => {
    expect(light.brand).toBe(light.primary);
    expect(dark.brand).toBe(dark.primary);
  });
});
