import { createApp } from './app';
import { ConfigError, loadConfig, type Config } from './config';
import { connectDb, dbState } from './db';
import { startJobs } from './jobs/runner';
import { defaultServices } from './services';
import { ensureSystemRoles } from './tenancy/role.model';

function readConfig(): Config {
  try {
    return loadConfig(process.env);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

const config = readConfig();
await connectDb(config.mongodbUri);
await ensureSystemRoles();
const services = defaultServices(config);
const server = createApp({ config, dbState, services }).listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}/api/v1`);
});
const jobs = config.jobsEnabled ? startJobs({ config, services }) : undefined;

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, async () => {
    await jobs?.stop();
    server.close();
    process.exit(0);
  });
}
