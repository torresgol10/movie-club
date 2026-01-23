
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { users } from './schema';
import { v4 as uuidv4 } from 'uuid';
import { eq } from 'drizzle-orm';
import * as dotenv from 'dotenv';

dotenv.config();

const sqlite = new Database('local.db');
const db = drizzle(sqlite);

async function main() {
    console.log('Seeding initial user...');

    const existingUser = await db.select().from(users).where(eq(users.name, 'torresgol10')).limit(1);

    if (existingUser.length > 0) {
        console.log('User torresgol10 already exists.');
        return;
    }

    await db.insert(users).values({
        id: uuidv4(),
        name: 'torresgol10',
        pin: '1234',
    });

    console.log('User torresgol10 created successfully.');
}

main().catch((err) => {
    console.error('Seeding failed:', err);
    process.exit(1);
});
