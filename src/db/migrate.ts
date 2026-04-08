import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { migrate } from 'drizzle-orm/bun-sql/migrator';
import { resolve } from 'node:path';
import { loadConfig, getDatabaseUrl } from '../config.js';

async function main() {
  const config = await loadConfig(process.cwd());
  const url = getDatabaseUrl(config);
  const client = new SQL(url);
  const db = drizzle({ client });
  const packageRoot = resolve(import.meta.dir, '../..'); // db/ -> src/ -> package root
  console.log('Running migrations...');
  await migrate(db, { migrationsFolder: resolve(packageRoot, 'drizzle') });
  console.log('Migrations complete.');
  client.close();
}

main().catch(console.error);
