import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import * as schema from './schema';

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let _client: InstanceType<typeof SQL> | null = null;

export function initDatabase(databaseUrl: string) {
  _client = new SQL(databaseUrl);
  _db = drizzle({ client: _client, schema });
}

export function getDb() {
  if (!_db) throw new Error('Database not initialized. Call initDatabase() first.');
  return _db;
}

export function getClient() {
  if (!_client) throw new Error('Database not initialized.');
  return _client;
}
