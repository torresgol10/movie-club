
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { users } from './schema';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import * as dotenv from 'dotenv';
import * as readline from 'readline';

dotenv.config();

const sqlite = new Database('local.db');
const db = drizzle(sqlite);

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function ask(question: string): Promise<string> {
    return new Promise((resolve) => {
        rl.question(question, resolve);
    });
}

async function main() {
    console.log('--- Create New User ---');

    const name = await ask('Enter Username: ');
    if (!name) {
        console.error('Username is required.');
        process.exit(1);
    }

    const existing = await db.select().from(users).where(eq(users.name, name));
    if (existing.length > 0) {
        console.error(`User '${name}' already exists.`);
        process.exit(1);
    }

    const pin = await ask('Enter 4-digit PIN: ');
    if (!pin || pin.length !== 4) {
        console.error('Valid 4-digit PIN is required.');
        process.exit(1);
    }

    await db.insert(users).values({
        id: uuidv4(),
        name,
        pin,
    });

    console.log(`User '${name}' created successfully!`);
    rl.close();
}

main().catch((err) => {
    console.error('Failed:', err);
    process.exit(1);
});
