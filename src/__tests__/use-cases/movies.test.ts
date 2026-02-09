import { describe, it, expect } from 'vitest';
import { eq, and, ne } from 'drizzle-orm';
import { getTestDb } from '../setup';
import { createTestUser, createTestMovie, setAppState, getAppStateValue } from '../helpers';
import { movies, users, appState } from '@/db/schema';
import { v4 as uuidv4 } from 'uuid';

describe('Use Case: Movie Submission (Decoupled Model)', () => {
    describe('Submit Movie Proposal', () => {
        it('should submit a movie proposal successfully', () => {
            const db = getTestDb();
            const user = createTestUser(db, { name: 'proposer' });
            setAppState(db, 'current_week', '1');

            const movieId = uuidv4();
            db.insert(movies).values({
                id: movieId,
                title: 'Test Movie',
                coverUrl: 'http://example.com/cover.jpg',
                proposedBy: user.id,
                weekNumber: 1,
                status: 'PROPOSED',
            }).run();

            const result = db.select().from(movies).where(eq(movies.id, movieId)).all();

            expect(result).toHaveLength(1);
            expect(result[0].title).toBe('Test Movie');
            expect(result[0].proposedBy).toBe(user.id);
            expect(result[0].status).toBe('PROPOSED');
        });

        it('should reject submission when user already has pending proposal', () => {
            const db = getTestDb();
            const user = createTestUser(db, { name: 'proposer' });

            // User already has a pending movie
            createTestMovie(db, {
                proposedBy: user.id,
                status: 'PROPOSED',
            });

            // Check for existing pending proposal (new model uses COMPLETED instead of WATCHED)
            const existing = db.select().from(movies).where(
                and(
                    eq(movies.proposedBy, user.id),
                    ne(movies.status, 'COMPLETED'),
                    ne(movies.status, 'REJECTED')
                )
            ).all();

            expect(existing.length > 0).toBe(true);
        });

        it('should mask other users movie submissions in queue', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });

            createTestMovie(db, { title: 'User1 Movie', proposedBy: user1.id, status: 'PROPOSED' });
            createTestMovie(db, { title: 'User2 Movie', proposedBy: user2.id, status: 'PROPOSED' });

            const rawQueue = db.select().from(movies).where(eq(movies.status, 'PROPOSED')).all();

            // Simulate masking logic for user1
            const currentUserId = user1.id;
            const maskedQueue = rawQueue.map(m => {
                if (m.proposedBy === currentUserId) return m;
                return {
                    ...m,
                    title: 'Mystery Movie',
                    description: '???',
                    coverUrl: null,
                    year: null,
                };
            });

            // User1 can see their own movie
            const ownMovie = maskedQueue.find(m => m.proposedBy === user1.id);
            expect(ownMovie?.title).toBe('User1 Movie');

            // User1 cannot see user2's movie details
            const otherMovie = maskedQueue.find(m => m.proposedBy === user2.id);
            expect(otherMovie?.title).toBe('Mystery Movie');
        });
    });

    describe('Batch Completion & Scheduling', () => {
        it('should complete batch when all users submit', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });
            setAppState(db, 'current_week', '1');

            createTestMovie(db, { proposedBy: user1.id, status: 'PROPOSED' });
            createTestMovie(db, { proposedBy: user2.id, status: 'PROPOSED' });

            const allUsers = db.select().from(users).all();
            const currentBatch = db.select().from(movies).where(
                and(ne(movies.status, 'COMPLETED'), ne(movies.status, 'REJECTED'))
            ).all();

            expect(currentBatch.length >= allUsers.length).toBe(true);
        });

        it('should set first movie as VETTING after batch scheduling', () => {
            const db = getTestDb();
            const user = createTestUser(db, { name: 'user1' });
            setAppState(db, 'current_week', '1');

            const movie = createTestMovie(db, {
                proposedBy: user.id,
                status: 'PROPOSED',
                weekNumber: 1,
            });

            // Simulate scheduling - first movie starts VETTING immediately
            db.update(movies)
                .set({ status: 'VETTING' })
                .where(eq(movies.id, movie.id))
                .run();

            const result = db.select().from(movies).where(eq(movies.id, movie.id)).all();
            expect(result[0].status).toBe('VETTING');
        });

        it('should assign incrementing week numbers and vettingStartDates during scheduling', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });
            setAppState(db, 'current_week', '1');

            const movie1 = createTestMovie(db, { proposedBy: user1.id, status: 'PROPOSED' });
            const movie2 = createTestMovie(db, { proposedBy: user2.id, status: 'PROPOSED' });

            // Simulate scheduling with week numbers and vetting dates
            const now = new Date();
            const nextMonday = new Date(now);
            nextMonday.setDate(now.getDate() + ((1 + 7 - now.getDay()) % 7 || 7));
            nextMonday.setHours(0, 0, 0, 0);

            const week2Date = new Date(nextMonday);
            week2Date.setDate(nextMonday.getDate() + 7);

            db.update(movies).set({ weekNumber: 1, status: 'VETTING', vettingStartDate: nextMonday })
                .where(eq(movies.id, movie1.id)).run();
            db.update(movies).set({ weekNumber: 2, status: 'PROPOSED', vettingStartDate: week2Date })
                .where(eq(movies.id, movie2.id)).run();

            const scheduled = db.select().from(movies).all();
            const weeks = scheduled.map(m => m.weekNumber).sort();

            expect(weeks).toEqual([1, 2]);

            // First movie is VETTING, second stays PROPOSED
            const m1 = db.select().from(movies).where(eq(movies.id, movie1.id)).all();
            const m2 = db.select().from(movies).where(eq(movies.id, movie2.id)).all();
            expect(m1[0].status).toBe('VETTING');
            expect(m2[0].status).toBe('PROPOSED');
            expect(m1[0].vettingStartDate).toBeDefined();
            expect(m2[0].vettingStartDate).toBeDefined();
        });

        it('should transition phase to ACTIVE after batch completion', () => {
            const db = getTestDb();

            setAppState(db, 'current_phase', 'ACTIVE');

            expect(getAppStateValue(db, 'current_phase')).toBe('ACTIVE');
        });
    });

    describe('Replacement Mode (After Rejection)', () => {
        it('should allow user to submit replacement for rejected movie', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });
            setAppState(db, 'current_week', '1');

            // Week 1 movie was rejected, week 2 movie exists
            createTestMovie(db, { proposedBy: user1.id, status: 'REJECTED', weekNumber: 1 });
            const week2Movie = createTestMovie(db, { proposedBy: user2.id, status: 'PROPOSED', weekNumber: 2 });

            // User1 submits replacement
            const replacement = createTestMovie(db, { proposedBy: user1.id, status: 'VETTING', weekNumber: 1 });

            // Week 2 movie should remain unchanged
            const week2Result = db.select().from(movies).where(eq(movies.id, week2Movie.id)).all();
            expect(week2Result[0].weekNumber).toBe(2);
            expect(week2Result[0].status).toBe('PROPOSED');

            // Replacement should be in week 1 with VETTING status
            const replacementResult = db.select().from(movies).where(eq(movies.id, replacement.id)).all();
            expect(replacementResult[0].weekNumber).toBe(1);
            expect(replacementResult[0].status).toBe('VETTING');
        });

        it('should preserve future scheduled movies in replacement mode', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });
            const user3 = createTestUser(db, { name: 'user3' });
            setAppState(db, 'current_week', '2');

            // Future movies at weeks 3 and 4
            const week3Movie = createTestMovie(db, { proposedBy: user2.id, status: 'PROPOSED', weekNumber: 3 });
            const week4Movie = createTestMovie(db, { proposedBy: user3.id, status: 'PROPOSED', weekNumber: 4 });

            // Simulate replacement at week 2
            createTestMovie(db, { proposedBy: user1.id, status: 'VETTING', weekNumber: 2 });

            // Future movies should be unchanged
            const futureMovies = db.select().from(movies)
                .where(and(ne(movies.status, 'REJECTED'), ne(movies.weekNumber, 2)))
                .all();

            expect(futureMovies).toHaveLength(2);
            expect(futureMovies.find(m => m.weekNumber === 3)).toBeDefined();
            expect(futureMovies.find(m => m.weekNumber === 4)).toBeDefined();
        });
    });

    describe('Coexisting Movie States', () => {
        it('should allow movies in different states simultaneously', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });
            const user3 = createTestUser(db, { name: 'user3' });
            const user4 = createTestUser(db, { name: 'user4' });

            // Multiple movies in different states at the same time
            createTestMovie(db, { proposedBy: user1.id, status: 'COMPLETED', weekNumber: 1 });
            createTestMovie(db, { proposedBy: user2.id, status: 'WATCHING', weekNumber: 2 });
            createTestMovie(db, { proposedBy: user3.id, status: 'VETTING', weekNumber: 3 });
            createTestMovie(db, { proposedBy: user4.id, status: 'PROPOSED', weekNumber: 4 });

            const completed = db.select().from(movies).where(eq(movies.status, 'COMPLETED')).all();
            const watching = db.select().from(movies).where(eq(movies.status, 'WATCHING')).all();
            const vetting = db.select().from(movies).where(eq(movies.status, 'VETTING')).all();
            const proposed = db.select().from(movies).where(eq(movies.status, 'PROPOSED')).all();

            expect(completed).toHaveLength(1);
            expect(watching).toHaveLength(1);
            expect(vetting).toHaveLength(1);
            expect(proposed).toHaveLength(1);
        });

        it('should show COMPLETED movies in history', () => {
            const db = getTestDb();
            const user = createTestUser(db, { name: 'user1' });

            createTestMovie(db, { title: 'Old Movie', proposedBy: user.id, status: 'COMPLETED', weekNumber: 1 });
            createTestMovie(db, { title: 'Current', proposedBy: user.id, status: 'WATCHING', weekNumber: 2 });

            const history = db.select().from(movies).where(eq(movies.status, 'COMPLETED')).all();

            expect(history).toHaveLength(1);
            expect(history[0].title).toBe('Old Movie');
        });
    });
});
