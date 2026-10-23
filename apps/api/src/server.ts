import { createApp } from './app';
import { ConfigError, loadConfig, type Config } from './config';
import { connectDb, dbState } from './db';

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
createApp({ config, dbState }).listen(config.port, () => {
  console.log(`API listening on http://localhost:${config.port}/api/v1`);
});
