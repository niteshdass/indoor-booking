import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', 'src');

/** The body of the `@media (pointer: coarse)` block in a CSS file. */
function coarseBlock(file: string): string {
  const text = readFileSync(join(SRC, file), 'utf8');
  const start = text.indexOf('@media (pointer: coarse)');
  expect(start, `${file} has no (pointer: coarse) block`).toBeGreaterThan(-1);
  return text.slice(start);
}

// jsdom cannot evaluate media queries, so check the rules exist where people tap most.
describe('touch targets on phones', () => {
  it.each([
    ['components/ui/Button.module.css', ['.sm', '.md']],
    ['components/AppShell.module.css', ['.nav a']],
    ['owner/shell/OwnerShell.module.css', ['.link', '.signOut']],
    ['components/ActionMenu.module.css', ['.trigger']],
  ])('%s grows %j to --control-lg', (file, selectors) => {
    const block = coarseBlock(file);
    for (const s of selectors) expect(block).toContain(s);
    expect(block).toContain('var(--control-lg)');
  });
});
