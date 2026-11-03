/**
 * Generates the app icon, Android adaptive icon layers and splash images from the web favicon mark
 * (four rounded squares, apps/web/public/favicon.svg), coloured from the design tokens.
 * Needs Google Chrome (headless) for rasterising. Run: pnpm --filter mobile icons
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dark, light } from '../src/theme/tokens';

const CHROME = process.env.CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = join(__dirname, '..', 'assets', 'images');
mkdirSync(OUT, { recursive: true });

/** The mark's bounding box in the favicon's 32-unit space: x 7..25, y 8..24. */
function mark(size: number, fraction: number, fill: string): string {
  const scale = (size * fraction) / 18;
  const ox = size / 2 - 16 * scale;
  const oy = size / 2 - 16 * scale;
  const sq = (x: number, y: number, o: number) =>
    `<rect x="${ox + x * scale}" y="${oy + y * scale}" width="${8 * scale}" height="${7 * scale}" rx="${1.5 * scale}" fill="${fill}" opacity="${o}"/>`;
  return sq(7, 8, 1) + sq(17, 8, 0.45) + sq(7, 17, 0.45) + sq(17, 17, 1);
}

function render(name: string, size: number, bg: string | null, body: string) {
  const dir = mkdtempSync(join(tmpdir(), 'icons-'));
  const html = join(dir, 'i.html');
  const rect = bg ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : '';
  writeFileSync(
    html,
    `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>` +
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${rect}${body}</svg>`,
  );
  execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--default-background-color=00000000',
    `--window-size=${size},${size}`, `--screenshot=${join(OUT, name)}`, `file://${html}`,
  ], { stdio: 'ignore' });
  console.log('wrote', name);
}

render('icon.png', 1024, light.primary, mark(1024, 0.5, light.primaryFg));
render('favicon.png', 48, light.primary, mark(48, 0.5, light.primaryFg));
// Adaptive icon: the launcher masks to the inner 66%, so the mark stays well inside it. Background is app.json's backgroundColor.
render('android-icon-foreground.png', 512, null, mark(512, 0.36, light.primaryFg));
render('android-icon-monochrome.png', 432, null, mark(432, 0.36, '#000000'));
render('splash-icon.png', 1024, null, mark(1024, 0.8, light.primary));
render('splash-icon-dark.png', 1024, null, mark(1024, 0.8, dark.primary));
