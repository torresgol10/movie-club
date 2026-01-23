
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { users } from './schema';
import { eq, ne } from 'drizzle-orm';
import * as dotenv from 'dotenv';

dotenv.config();

const sqlite = new Database('local.db');
const db = drizzle(sqlite);

async function main() {
    console.log('Cleaning up duplicate users...');

    const allUsers = await db.select().from(users).where(eq(users.name, 'torresgol10'));

    if (allUsers.length <= 1) {
        console.log('No duplicates found.');
        return;
    }

    // Keep the first one, delete the rest
    const userToKeep = allUsers[0];
    console.log(`Keeping user: ${userToKeep.id}`);

    for (let i = 1; i < allUsers.length; i++) {
        const userToDelete = allUsers[i];
        console.log(`Deleting duplicate user: ${userToDelete.id}`);
        await db.delete(users).where(eq(users.id, userToDelete.id));
    }

    console.log('Cleanup complete.');
}

main().catch((err) => {
    console.error('Cleanup failed:', err);
    process.exit(1);
});
