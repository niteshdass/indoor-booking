import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '..', '..', 'src', 'owner', 'today', 'TodayPage.module.css'), 'utf8');

/** Declarations of the first top-level rule with exactly this selector. */
function rule(selector: string): string {
  const m = css.match(new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')} \\{([^}]*)\\}`));
  expect(m, `${selector} rule`).not.toBeNull();
  return m![1]!;
}

// WCAG 1.4.1: the court timeline can't tell booking kinds apart by colour alone.
describe('court timeline kinds differ by shape, not only colour', () => {
  it('waiting blocks are dashed', () => {
    expect(rule('.wait')).toMatch(/border-style:\s*dashed/);
  });

  it('walk-ins carry a thick start bar', () => {
    expect(rule('.walk')).toMatch(/border-inline-start-width:\s*var\(--status-bar\)/);
  });

  it('confirmed blocks keep the plain solid border', () => {
    expect(rule('.ok')).not.toMatch(/border-style|border-inline-start-width/);
  });

  it('legend swatches draw the same pattern', () => {
    expect(rule('.legend li::before')).toMatch(/var\(--legend-line, solid\)/);
    expect(rule('.legend li::before')).toMatch(/var\(--legend-bar, 1px\)/);
  });
});
