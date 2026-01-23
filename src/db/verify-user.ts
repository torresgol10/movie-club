
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { users } from './schema';
import { eq } from 'drizzle-orm';
import * as dotenv from 'dotenv';

dotenv.config();

const sqlite = new Database('local.db');
const db = drizzle(sqlite);

async function main() {
    console.log('Verifying user...');

    const user = await db.select().from(users).where(eq(users.name, 'torresgol10'));

    if (user.length > 0) {
        console.log(`Verification Success: Found ${user.length} users with name 'torresgol10':`);
        user.forEach(u => console.log(u));
    } else {
        console.error('Verification Failed: User torresgol10 NOT found.');
        process.exit(1);
    }
}

main().catch((err) => {
    console.error('Verification script failed:', err);
    process.exit(1);
});
