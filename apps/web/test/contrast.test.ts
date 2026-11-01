import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '..', 'src', 'styles', 'tokens.css'), 'utf8');

/** Custom properties declared in the first block that starts with `selector`. */
function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}

type Rgba = [number, number, number, number];

function parse(value: string): Rgba {
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16)).concat(1) as Rgba;
  const rgba = value.match(/^rgba?\(([^)]+)\)$/);
  if (!rgba) throw new Error(`not a colour: ${value}`);
  const [r, g, b, a = '1'] = rgba[1]!.split(',').map((s) => s.trim());
  return [Number(r), Number(g), Number(b), Number(a)];
}

/** Paints a translucent colour over an opaque one. */
function over(top: Rgba, under: Rgba): Rgba {
  const a = top[3];
  return [0, 1, 2].map((i) => top[i]! * a + under[i]! * (1 - a)).concat(1) as Rgba;
}

function luminance([r, g, b]: Rgba): number {
  const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratio(a: Rgba, b: Rgba): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

const themes = { light: block(':root'), dark: block(":root[data-theme='dark'],\n[data-surface='night']") };

describe.each(Object.entries(themes))('%s theme contrast', (_name, t) => {
  const surface = parse(t['--bg-surface']!);

  it.each(['success', 'warning', 'danger', 'info'])('%s badge text passes AA on its soft background', (tone) => {
    const bg = over(parse(t[`--${tone}-soft`]!), surface);
    expect(ratio(parse(t[`--${tone}`]!), bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['--bg-page', '--bg-surface', '--bg-surface-raised'])('focus ring stands out 3:1 against %s', (bg) => {
    expect(ratio(parse(t['--primary']!), parse(t[bg]!))).toBeGreaterThanOrEqual(3);
  });
});
