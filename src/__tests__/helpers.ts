import { v4 as uuidv4 } from 'uuid';
import { users, movies, appState, vettingResponses, votes } from '@/db/schema';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '@/db/schema';

type TestDb = BetterSQLite3Database<typeof schema>;

// User factory
export function createTestUser(db: TestDb, overrides: Partial<typeof users.$inferInsert> = {}) {
    const user = {
        id: uuidv4(),
        name: `user_${Date.now()}`,
        pin: '1234',
        ...overrides,
    };
    db.insert(users).values(user).run();
    return user;
}

// Movie factory
export function createTestMovie(db: TestDb, overrides: Partial<typeof movies.$inferInsert> = {}) {
    const movie = {
        id: uuidv4(),
        title: `Movie ${Date.now()}`,
        status: 'PROPOSED' as const,
        ...overrides,
    };
    db.insert(movies).values(movie).run();
    return movie;
}

// App state helpers
export function setAppState(db: TestDb, key: string, value: string) {
    db.insert(appState).values({ key, value })
        .onConflictDoUpdate({ target: appState.key, set: { value } })
        .run();
}

export function getAppStateValue(db: TestDb, key: string): string | null {
    const { eq } = require('drizzle-orm');
    const result = db.select().from(appState).where(eq(appState.key, key)).limit(1).all();
    return result[0]?.value || null;
}

// Vetting response factory
export function createVettingResponse(
    db: TestDb,
    movieId: string,
    userId: string,
    response: 'SEEN' | 'NOT_SEEN' = 'NOT_SEEN'
) {
    const vr = {
        id: uuidv4(),
        movieId,
        userId,
        response,
    };
    db.insert(vettingResponses).values(vr).run();
    return vr;
}

// Vote factory
export function createVote(
    db: TestDb,
    movieId: string,
    userId: string,
    score: number
) {
    const vote = {
        id: uuidv4(),
        movieId,
        userId,
        score,
    };
    db.insert(votes).values(vote).run();
    return vote;
}

// Session mock helper
export function mockSession(userId: string, userName: string) {
    return {
        user: { id: userId, name: userName },
        expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    };
}
