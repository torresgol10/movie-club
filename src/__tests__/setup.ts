import { beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { sql } from 'drizzle-orm';
import * as schema from '@/db/schema';

// In-memory database for testing
let testDb: BetterSQLite3Database<typeof schema>;
let sqlite: Database.Database;

export function getTestDb() {
    return testDb;
}

export function getTestSqlite() {
    return sqlite;
}

// Setup before each test
beforeEach(() => {
    // Create in-memory database
    sqlite = new Database(':memory:');
    testDb = drizzle(sqlite, { schema });

    // Create tables
    sqlite.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            pin TEXT NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now'))
        );

        CREATE TABLE IF NOT EXISTS movies (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            description TEXT,
            year INTEGER,
            cover_url TEXT,
            proposed_by TEXT REFERENCES users(id),
            status TEXT DEFAULT 'PROPOSED',
            week_number INTEGER,
            created_at INTEGER DEFAULT (strftime('%s', 'now'))
        );

        CREATE TABLE IF NOT EXISTS votes (
            id TEXT PRIMARY KEY,
            movie_id TEXT REFERENCES movies(id),
            user_id TEXT REFERENCES users(id),
            score INTEGER,
            comment TEXT,
            created_at INTEGER DEFAULT (strftime('%s', 'now'))
        );

        CREATE TABLE IF NOT EXISTS app_state (
            key TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE TABLE IF NOT EXISTS vetting_responses (
            id TEXT PRIMARY KEY,
            movie_id TEXT REFERENCES movies(id),
            user_id TEXT REFERENCES users(id),
            response TEXT,
            created_at INTEGER DEFAULT (strftime('%s', 'now'))
        );
    `);
});

// Cleanup after each test
afterEach(() => {
    if (sqlite) {
        sqlite.close();
    }
});

// Mock the session helper
vi.mock('@/lib/auth', () => ({
    getSession: vi.fn(),
    encrypt: vi.fn(),
    decrypt: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
}));
