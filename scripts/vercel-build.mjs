/* global console */
// Builds web + API into one Vercel deployment (Build Output API v3):
// apps/web/dist is served as static files, apps/api is bundled into a single function at /api.
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

const out = '.vercel/output';
const fn = `${out}/functions/api.func`;
rmSync(out, { recursive: true, force: true });

execSync('pnpm --filter web build', { stdio: 'inherit' });
cpSync('apps/web/dist', `${out}/static`, { recursive: true });

mkdirSync(fn, { recursive: true });
await build({
  entryPoints: ['apps/api/src/serverless.ts'],
  outfile: `${fn}/index.js`,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  // Optional MongoDB driver add-ons, loaded in try/catch only when configured.
  external: [
    'kerberos',
    '@mongodb-js/zstd',
    'snappy',
    'socks',
    'aws4',
    'mongodb-client-encryption',
    '@aws-sdk/credential-providers',
  ],
  logLevel: 'info',
});
// The repo root is "type": "module"; the bundle is CommonJS.
writeFileSync(`${fn}/package.json`, JSON.stringify({ type: 'commonjs' }));
writeFileSync(
  `${fn}/.vc-config.json`,
  JSON.stringify({
    runtime: 'nodejs22.x',
    handler: 'index.js',
    launcherType: 'Nodejs',
    // Express reads the raw body itself (Stripe webhooks need the exact bytes).
    shouldAddHelpers: false,
    maxDuration: 60,
  }),
);

writeFileSync(
  `${out}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
        { src: '^/api/(.*)$', dest: '/api' },
        { handle: 'filesystem' },
        { src: '/(.*)', dest: '/index.html' },
      ],
      // Hobby allows one run a day; an outside pinger covers the rest (docs/demo.md).
      crons: [{ path: '/api/v1/jobs/tick', schedule: '0 3 * * *' }],
    },
    null,
    2,
  ),
);
console.log(`Vercel output written to ${out}`);
