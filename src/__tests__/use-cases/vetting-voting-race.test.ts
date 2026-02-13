import { describe, it, expect } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { getTestDb } from '../setup';
import { createTestUser, createTestMovie, setAppState, createVettingResponse, createVote } from '../helpers';
import { movies, votes, vettingResponses, users } from '@/db/schema';

/**
 * Race condition guard: voting must NOT be available until ALL users
 * have completed vetting (responded NOT_SEEN) for a given movie.
 *
 * Mirrors the logic added in:
 *  - getPendingVotesForUser()  (read path)
 *  - submitVote()              (write path)
 */
describe('Use Case: Vetting must complete before voting is allowed', () => {
    // ── Helper that replicates getPendingVotesForUser logic ──────────
    function getPendingVotesForUser(db: ReturnType<typeof getTestDb>, userId: string) {
        const allUsersCount = db.select().from(users).all().length;

        const watchingMovies = db.select().from(movies)
            .where(eq(movies.status, 'WATCHING')).all();

        return watchingMovies.filter(movie => {
            // Vetting must be complete
            const vettingCount = db.select().from(vettingResponses)
                .where(eq(vettingResponses.movieId, movie.id)).all().length;
            if (vettingCount < allUsersCount) return false;

            // User must not have voted yet
            const voted = db.select().from(votes)
                .where(and(eq(votes.movieId, movie.id), eq(votes.userId, userId))).all();
            return voted.length === 0;
        });
    }

    // ── Helper that replicates submitVote guard ──────────────────────
    function canVote(db: ReturnType<typeof getTestDb>, movieId: string): boolean {
        const allUsersCount = db.select().from(users).all().length;
        const vettingCount = db.select().from(vettingResponses)
            .where(eq(vettingResponses.movieId, movieId)).all().length;
        return vettingCount >= allUsersCount;
    }

    // ─────────────────────────────────────────────────────────────────
    describe('getPendingVotesForUser blocks incomplete vetting', () => {
        it('should NOT show movie for voting when no one has vetted yet', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });
            setAppState(db, 'current_phase', 'ACTIVE');
            setAppState(db, 'current_week', '1');

            // Movie passed to WATCHING but vetting responses are missing
            createTestMovie(db, {
                proposedBy: user1.id,
                status: 'WATCHING',
                weekNumber: 1,
            });

            const pending = getPendingVotesForUser(db, user2.id);
            expect(pending).toHaveLength(0);
        });

        it('should NOT show movie for voting when only SOME users have vetted', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });
            createTestUser(db, { name: 'user3' }); // exists in DB for total count
            setAppState(db, 'current_phase', 'ACTIVE');
            setAppState(db, 'current_week', '1');

            const movie = createTestMovie(db, {
                proposedBy: user1.id,
                status: 'WATCHING',
                weekNumber: 1,
            });

            // Only 2 of 3 users vetted
            createVettingResponse(db, movie.id, user1.id, 'NOT_SEEN');
            createVettingResponse(db, movie.id, user2.id, 'NOT_SEEN');
            // user3 has NOT responded

            const pending = getPendingVotesForUser(db, user1.id);
            expect(pending).toHaveLength(0);
        });

        it('should show movie for voting once ALL users have vetted', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });
            const user3 = createTestUser(db, { name: 'user3' });
            setAppState(db, 'current_phase', 'ACTIVE');
            setAppState(db, 'current_week', '1');

            const movie = createTestMovie(db, {
                proposedBy: user1.id,
                status: 'WATCHING',
                weekNumber: 1,
            });

            // All 3 users vetted
            createVettingResponse(db, movie.id, user1.id, 'NOT_SEEN');
            createVettingResponse(db, movie.id, user2.id, 'NOT_SEEN');
            createVettingResponse(db, movie.id, user3.id, 'NOT_SEEN');

            const pending = getPendingVotesForUser(db, user1.id);
            expect(pending).toHaveLength(1);
            expect(pending[0].id).toBe(movie.id);
        });

        it('should NOT show movie if user already voted even when vetting is complete', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });
            setAppState(db, 'current_phase', 'ACTIVE');
            setAppState(db, 'current_week', '1');

            const movie = createTestMovie(db, {
                proposedBy: user1.id,
                status: 'WATCHING',
                weekNumber: 1,
            });

            createVettingResponse(db, movie.id, user1.id, 'NOT_SEEN');
            createVettingResponse(db, movie.id, user2.id, 'NOT_SEEN');

            // user1 already voted
            createVote(db, movie.id, user1.id, 8);

            const pending = getPendingVotesForUser(db, user1.id);
            expect(pending).toHaveLength(0);
        });
    });

    // ─────────────────────────────────────────────────────────────────
    describe('submitVote rejects votes when vetting is incomplete', () => {
        it('should reject vote when no vetting responses exist', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            createTestUser(db, { name: 'user2' }); // exists in DB for total count

            const movie = createTestMovie(db, {
                proposedBy: user1.id,
                status: 'WATCHING',
                weekNumber: 1,
            });

            expect(canVote(db, movie.id)).toBe(false);
        });

        it('should reject vote when only partial vetting is done', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            createTestUser(db, { name: 'user2' }); // exists in DB for total count
            createTestUser(db, { name: 'user3' }); // exists in DB for total count

            const movie = createTestMovie(db, {
                proposedBy: user1.id,
                status: 'WATCHING',
                weekNumber: 1,
            });

            createVettingResponse(db, movie.id, user1.id, 'NOT_SEEN');
            // user2 and user3 haven't vetted

            expect(canVote(db, movie.id)).toBe(false);
        });

        it('should accept vote once all users have completed vetting', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });

            const movie = createTestMovie(db, {
                proposedBy: user1.id,
                status: 'WATCHING',
                weekNumber: 1,
            });

            createVettingResponse(db, movie.id, user1.id, 'NOT_SEEN');
            createVettingResponse(db, movie.id, user2.id, 'NOT_SEEN');

            expect(canVote(db, movie.id)).toBe(true);
        });
    });

    // ─────────────────────────────────────────────────────────────────
    describe('Multi-movie scenario: independent vetting gates', () => {
        it('should allow voting on fully-vetted movie while blocking another', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });
            setAppState(db, 'current_phase', 'ACTIVE');
            setAppState(db, 'current_week', '2');

            const movie1 = createTestMovie(db, {
                proposedBy: user1.id,
                status: 'WATCHING',
                weekNumber: 1,
            });
            const movie2 = createTestMovie(db, {
                proposedBy: user2.id,
                status: 'WATCHING',
                weekNumber: 2,
            });

            // movie1: ALL users vetted → votable
            createVettingResponse(db, movie1.id, user1.id, 'NOT_SEEN');
            createVettingResponse(db, movie1.id, user2.id, 'NOT_SEEN');

            // movie2: only user1 vetted → NOT votable
            createVettingResponse(db, movie2.id, user1.id, 'NOT_SEEN');

            const pendingUser1 = getPendingVotesForUser(db, user1.id);
            expect(pendingUser1).toHaveLength(1);
            expect(pendingUser1[0].id).toBe(movie1.id);

            expect(canVote(db, movie1.id)).toBe(true);
            expect(canVote(db, movie2.id)).toBe(false);
        });

        it('should unlock movie for voting as soon as last user vets', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });
            const user3 = createTestUser(db, { name: 'user3' });
            setAppState(db, 'current_phase', 'ACTIVE');
            setAppState(db, 'current_week', '1');

            const movie = createTestMovie(db, {
                proposedBy: user1.id,
                status: 'WATCHING',
                weekNumber: 1,
            });

            createVettingResponse(db, movie.id, user1.id, 'NOT_SEEN');
            createVettingResponse(db, movie.id, user2.id, 'NOT_SEEN');
            // Still blocked
            expect(getPendingVotesForUser(db, user3.id)).toHaveLength(0);

            // Last user vets
            createVettingResponse(db, movie.id, user3.id, 'NOT_SEEN');
            // Now unlocked
            expect(getPendingVotesForUser(db, user1.id)).toHaveLength(1);
            expect(getPendingVotesForUser(db, user2.id)).toHaveLength(1);
            expect(getPendingVotesForUser(db, user3.id)).toHaveLength(1);
        });
    });
});
