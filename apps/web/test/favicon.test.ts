import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');

describe('favicon', () => {
  it('index.html links an icon that ships in public/', () => {
    const html = readFileSync(resolve(root, 'index.html'), 'utf8');
    const href = /<link rel="icon"[^>]*href="\/([^"]+)"/.exec(html)?.[1];
    expect(href).toBeTruthy();
    expect(existsSync(resolve(root, 'public', href!))).toBe(true);
  });
});
