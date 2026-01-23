import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import * as schema from './schema';
import path from 'path';

const dbPath = process.env.DB_FILE_NAME || path.join(process.cwd(), 'local.db');
const sqlite = new Database(dbPath);
export const db = drizzle(sqlite, { schema });
