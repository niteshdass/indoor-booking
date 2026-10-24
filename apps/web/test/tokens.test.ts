import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(__dirname, '..', 'src');
const TOKENS = join('styles', 'tokens.css');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const PROPS =
  'color|background|background-color|border-color|fill|stroke|font-size|padding(?:-[a-z]+)*|margin(?:-[a-z]+)*|gap|row-gap|column-gap|border-radius|box-shadow';
const LITERAL = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(|(?<![\w-])\d*\.?\d+(?:px|rem|em)\b/i;
const CSS_DECL = new RegExp(`(?:^|[;{\\s])(?:${PROPS})\\s*:\\s*([^;}]*)`, 'gi');

/** Remove var(--x) so a fallback or name cannot look like a literal; calc() of vars/unitless numbers then has none. */
function stripVars(value: string): string {
  return value.replace(/var\(\s*--[\w-]+\s*\)/g, '');
}

export function cssViolations(text: string): number[] {
  const lines: number[] = [];
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  for (const m of clean.matchAll(CSS_DECL)) {
    if (LITERAL.test(stripVars(m[1]!))) lines.push(clean.slice(0, m.index).split('\n').length + (m[0].match(/^\s*\n/) ? 1 : 0));
  }
  return lines;
}

const TSX_PROPS =
  'color|background|backgroundColor|borderColor|fill|stroke|fontSize|padding\\w*|margin\\w*|gap|rowGap|columnGap|borderRadius|boxShadow';
const TSX_STYLE = new RegExp(
  `\\b(?:${TSX_PROPS})\\s*:\\s*(?:-?\\d|['"\`]\\s*(?:#|rgba?\\(|hsla?\\(|-?\\d*\\.?\\d+(?:px|rem|em)))`,
);

export function tsxViolations(text: string): number[] {
  const lines: number[] = [];
  const re = /style=\{\{([\s\S]*?)\}\}/g;
  for (const m of text.matchAll(re)) {
    if (TSX_STYLE.test(m[1]!)) lines.push(text.slice(0, m.index).split('\n').length);
  }
  return lines;
}

describe('design tokens guard', () => {
  it('detects literals (self-check)', () => {
    expect(cssViolations('a { color: #fff; }')).toHaveLength(1);
    expect(cssViolations('a { padding: 8px 0; }')).toHaveLength(1);
    expect(cssViolations('a { margin-top: 0; gap: var(--space-2); padding: calc(var(--a) * 2); }')).toHaveLength(0);
    expect(tsxViolations('<div style={{ padding: 8 }} />')).toHaveLength(1);
    expect(tsxViolations("<div style={{ color: '#fff' }} />")).toHaveLength(1);
    expect(tsxViolations("<div style={{ color: 'var(--fg)' }} />")).toHaveLength(0);
  });

  it('uses no hardcoded design values outside tokens.css', () => {
    const found: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file);
      if (rel === TOKENS || rel.split(sep).join('/') === 'styles/tokens.css') continue;
      const text = readFileSync(file, 'utf8');
      const lines = file.endsWith('.css') ? cssViolations(text) : file.endsWith('.tsx') ? tsxViolations(text) : [];
      for (const l of lines) found.push(`${rel}:${l}`);
    }
    expect(found, `Hardcoded values (use var(--…) tokens):\n${found.join('\n')}`).toEqual([]);
  });
});
