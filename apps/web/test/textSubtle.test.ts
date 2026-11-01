import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(__dirname, '..', 'src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// --text-subtle is about 3:1, enough for icons and disabled controls but not for text (AA needs 4.5:1).
// Rules allowed to colour something with it: icon-only rules and disabled states.
const ALLOWED = /:disabled|chevron|icon/i;

describe('--text-subtle is never a text colour', () => {
  it('only icon and disabled rules use it as color', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC).filter((f) => f.endsWith('.css') && !f.endsWith(join('styles', 'tokens.css')))) {
      const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const m of text.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
        const [, selector, body] = m;
        if (!/(^|[;\s])color\s*:\s*var\(--text-subtle\)/.test(body!)) continue;
        if (ALLOWED.test(selector!) || /stroke\s*:\s*currentColor/.test(body!)) continue;
        offenders.push(`${relative(SRC, file).split(sep).join('/')}: ${selector!.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
