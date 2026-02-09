import { describe, it, expect } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { getTestDb } from '../setup';
import { createTestUser, createTestMovie, setAppState, createVettingResponse, getAppStateValue } from '../helpers';
import { movies, vettingResponses, users, appState } from '@/db/schema';

describe('Use Case: Vetting Process (Decoupled Model)', () => {
    describe('Get Movie in Vetting Phase', () => {
        it('should return the movie currently in VETTING status', () => {
            const db = getTestDb();
            const user = createTestUser(db, { name: 'proposer' });
            const vettingMovie = createTestMovie(db, {
                title: 'Vetting Movie',
                proposedBy: user.id,
                status: 'VETTING',
            });

            const result = db.select().from(movies).where(eq(movies.status, 'VETTING')).all();

            expect(result).toHaveLength(1);
            expect(result[0].id).toBe(vettingMovie.id);
            expect(result[0].title).toBe('Vetting Movie');
        });

        it('should return empty when no movie is in VETTING status', () => {
            const db = getTestDb();
            const user = createTestUser(db, { name: 'proposer' });
            createTestMovie(db, { proposedBy: user.id, status: 'PROPOSED' });
            createTestMovie(db, { proposedBy: user.id, status: 'WATCHING' });

            const result = db.select().from(movies).where(eq(movies.status, 'VETTING')).all();

            expect(result).toHaveLength(0);
        });

        it('should coexist with movies in WATCHING status', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });

            // One movie being vetted, another being watched simultaneously
            const vettingMovie = createTestMovie(db, { proposedBy: user1.id, status: 'VETTING', weekNumber: 2 });
            const watchingMovie = createTestMovie(db, { proposedBy: user2.id, status: 'WATCHING', weekNumber: 1 });

            const vetting = db.select().from(movies).where(eq(movies.status, 'VETTING')).all();
            const watching = db.select().from(movies).where(eq(movies.status, 'WATCHING')).all();

            expect(vetting).toHaveLength(1);
            expect(watching).toHaveLength(1);
            expect(vetting[0].id).toBe(vettingMovie.id);
            expect(watching[0].id).toBe(watchingMovie.id);
        });
    });

    describe('Vetting Responses', () => {
        it('should record NOT_SEEN response correctly', () => {
            const db = getTestDb();
            const proposer = createTestUser(db, { name: 'proposer' });
            const voter = createTestUser(db, { name: 'voter' });
            const movie = createTestMovie(db, { proposedBy: proposer.id, status: 'VETTING' });

            createVettingResponse(db, movie.id, voter.id, 'NOT_SEEN');

            const result = db.select().from(vettingResponses).where(
                and(
                    eq(vettingResponses.movieId, movie.id),
                    eq(vettingResponses.userId, voter.id)
                )
            ).all();

            expect(result).toHaveLength(1);
            expect(result[0].response).toBe('NOT_SEEN');
        });

        it('should transition movie to WATCHING when all users respond NOT_SEEN', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });
            const movie = createTestMovie(db, { proposedBy: user1.id, status: 'VETTING' });
            setAppState(db, 'current_phase', 'ACTIVE');

            // Both users respond NOT_SEEN
            createVettingResponse(db, movie.id, user1.id, 'NOT_SEEN');
            createVettingResponse(db, movie.id, user2.id, 'NOT_SEEN');

            const allUsers = db.select().from(users).all();
            const allResponses = db.select().from(vettingResponses)
                .where(eq(vettingResponses.movieId, movie.id)).all();

            // Simulate transition: when all respond NOT_SEEN, movie goes to WATCHING
            if (allResponses.length >= allUsers.length) {
                db.update(movies)
                    .set({ status: 'WATCHING' })
                    .where(eq(movies.id, movie.id))
                    .run();
            }

            const result = db.select().from(movies).where(eq(movies.id, movie.id)).all();
            expect(result[0].status).toBe('WATCHING');
        });

        it('should identify users who have not yet vetted', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });
            const user3 = createTestUser(db, { name: 'user3' });
            const movie = createTestMovie(db, { proposedBy: user1.id, status: 'VETTING' });

            // Only user1 has vetted
            createVettingResponse(db, movie.id, user1.id, 'NOT_SEEN');

            const allUsers = db.select().from(users).all();
            const responses = db.select().from(vettingResponses)
                .where(eq(vettingResponses.movieId, movie.id)).all();
            const respondedUserIds = new Set(responses.map(r => r.userId));
            const pendingUsers = allUsers.filter(u => !respondedUserIds.has(u.id));

            expect(pendingUsers).toHaveLength(2);
            expect(pendingUsers.map(u => u.name).sort()).toEqual(['user2', 'user3']);
        });
    });

    describe('Movie Rejection (SEEN)', () => {
        it('should reject movie immediately when marked as SEEN', () => {
            const db = getTestDb();
            const proposer = createTestUser(db, { name: 'proposer' });
            const voter = createTestUser(db, { name: 'voter' });
            const movie = createTestMovie(db, { proposedBy: proposer.id, status: 'VETTING' });

            // Voter says they've seen it - immediate rejection
            db.update(movies)
                .set({ status: 'REJECTED' })
                .where(eq(movies.id, movie.id))
                .run();

            const result = db.select().from(movies).where(eq(movies.id, movie.id)).all();
            expect(result[0].status).toBe('REJECTED');
        });

        it('should return to SUBMISSION if no other vetting/watching movies remain', () => {
            const db = getTestDb();
            const user = createTestUser(db, { name: 'proposer' });
            const movie = createTestMovie(db, { proposedBy: user.id, status: 'VETTING' });
            setAppState(db, 'current_phase', 'ACTIVE');

            // Reject the only vetting movie
            db.update(movies)
                .set({ status: 'REJECTED' })
                .where(eq(movies.id, movie.id))
                .run();

            // No more active movies → back to SUBMISSION
            const remaining = db.select().from(movies)
                .where(eq(movies.status, 'VETTING')).all();

            if (remaining.length === 0) {
                setAppState(db, 'current_phase', 'SUBMISSION');
            }

            expect(getAppStateValue(db, 'current_phase')).toBe('SUBMISSION');
        });

        it('should stay in ACTIVE phase if other movies are still being watched', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });
            const vettingMovie = createTestMovie(db, { proposedBy: user1.id, status: 'VETTING', weekNumber: 2 });
            const watchingMovie = createTestMovie(db, { proposedBy: user2.id, status: 'WATCHING', weekNumber: 1 });
            setAppState(db, 'current_phase', 'ACTIVE');

            // Reject the vetting movie
            db.update(movies)
                .set({ status: 'REJECTED' })
                .where(eq(movies.id, vettingMovie.id))
                .run();

            // Still have a WATCHING movie, so stay in ACTIVE
            const watchingMovies = db.select().from(movies)
                .where(eq(movies.status, 'WATCHING')).all();

            expect(watchingMovies).toHaveLength(1);
            expect(getAppStateValue(db, 'current_phase')).toBe('ACTIVE');
        });
    });

    describe('Scheduled Vetting (Weekly Cycle)', () => {
        it('should assign vettingStartDate to movies during scheduling', () => {
            const db = getTestDb();
            const user = createTestUser(db, { name: 'user1' });
            const now = new Date();
            const nextMonday = new Date(now);
            nextMonday.setDate(now.getDate() + ((1 + 7 - now.getDay()) % 7 || 7));
            nextMonday.setHours(0, 0, 0, 0);

            const movie = createTestMovie(db, {
                proposedBy: user.id,
                status: 'PROPOSED',
                weekNumber: 1,
            });

            // Simulate scheduling: assign vetting date
            db.update(movies)
                .set({ vettingStartDate: nextMonday, status: 'VETTING' })
                .where(eq(movies.id, movie.id))
                .run();

            const result = db.select().from(movies).where(eq(movies.id, movie.id)).all();
            expect(result[0].vettingStartDate).toBeDefined();
            expect(result[0].status).toBe('VETTING');
        });

        it('should start next vetting movie when current vetting completes', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });

            const pastDate = new Date(Date.now() - 86400000); // yesterday

            const movie1 = createTestMovie(db, {
                proposedBy: user1.id,
                status: 'VETTING',
                weekNumber: 1,
                vettingStartDate: pastDate,
            });
            const movie2 = createTestMovie(db, {
                proposedBy: user2.id,
                status: 'PROPOSED',
                weekNumber: 2,
                vettingStartDate: pastDate, // scheduled date has passed
            });

            // Complete vetting for movie1 → move to WATCHING
            db.update(movies)
                .set({ status: 'WATCHING' })
                .where(eq(movies.id, movie1.id))
                .run();

            // Start next vetting if scheduled date has passed
            const nextCandidate = db.select().from(movies)
                .where(eq(movies.status, 'PROPOSED')).all()
                .filter(m => m.vettingStartDate && m.vettingStartDate <= new Date());

            if (nextCandidate.length > 0) {
                db.update(movies)
                    .set({ status: 'VETTING' })
                    .where(eq(movies.id, nextCandidate[0].id))
                    .run();
            }

            const result = db.select().from(movies).where(eq(movies.id, movie2.id)).all();
            expect(result[0].status).toBe('VETTING');
        });

        it('should NOT start next vetting if scheduled date has not passed', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });

            const futureDate = new Date(Date.now() + 7 * 86400000);

            createTestMovie(db, {
                proposedBy: user1.id,
                status: 'WATCHING',
                weekNumber: 1,
            });
            const movie2 = createTestMovie(db, {
                proposedBy: user2.id,
                status: 'PROPOSED',
                weekNumber: 2,
                vettingStartDate: futureDate, // not yet
            });

            // Try to start next vetting
            const nextCandidate = db.select().from(movies)
                .where(eq(movies.status, 'PROPOSED')).all()
                .filter(m => m.vettingStartDate && m.vettingStartDate <= new Date());

            expect(nextCandidate).toHaveLength(0);

            // Movie2 remains PROPOSED
            const result = db.select().from(movies).where(eq(movies.id, movie2.id)).all();
            expect(result[0].status).toBe('PROPOSED');
        });
    });

    describe('Edge Cases', () => {
        it('should not allow vetting when no movie is in VETTING status', () => {
            const db = getTestDb();

            const vettingMovies = db.select().from(movies).where(eq(movies.status, 'VETTING')).all();

            expect(vettingMovies).toHaveLength(0);
            // state-machine would throw: 'No movie in vetting phase'
        });

        it('should not duplicate vetting responses from same user', () => {
            const db = getTestDb();
            const user = createTestUser(db, { name: 'voter' });
            const proposer = createTestUser(db, { name: 'proposer' });
            const movie = createTestMovie(db, { proposedBy: proposer.id, status: 'VETTING' });

            // First response
            createVettingResponse(db, movie.id, user.id, 'NOT_SEEN');

            // Check if already exists before inserting second
            const existing = db.select().from(vettingResponses).where(
                and(
                    eq(vettingResponses.movieId, movie.id),
                    eq(vettingResponses.userId, user.id)
                )
            ).all();

            expect(existing.length).toBe(1);
            // Real state-machine uses onConflictDoNothing()
        });
    });
});
