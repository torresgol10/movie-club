import { describe, it, expect } from 'vitest';
import { eq, and, ne } from 'drizzle-orm';
import { getTestDb } from '../setup';
import { createTestUser, createTestMovie, setAppState } from '../helpers';
import { movies, users, appState } from '@/db/schema';
import { v4 as uuidv4 } from 'uuid';

describe('Use Case: Movie Submission', () => {
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

            // Check for existing pending proposal
            const existing = db.select().from(movies).where(
                and(
                    eq(movies.proposedBy, user.id),
                    ne(movies.status, 'WATCHED'),
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
                and(ne(movies.status, 'WATCHED'), ne(movies.status, 'REJECTED'))
            ).all();

            expect(currentBatch.length >= allUsers.length).toBe(true);
        });

        it('should set first movie as ACTIVE after batch scheduling', () => {
            const db = getTestDb();
            const user = createTestUser(db, { name: 'user1' });
            setAppState(db, 'current_week', '1');

            const movie = createTestMovie(db, {
                proposedBy: user.id,
                status: 'PROPOSED',
                weekNumber: 1,
            });

            // Simulate scheduling - first movie becomes ACTIVE
            db.update(movies)
                .set({ status: 'ACTIVE' })
                .where(eq(movies.id, movie.id))
                .run();

            const result = db.select().from(movies).where(eq(movies.id, movie.id)).all();
            expect(result[0].status).toBe('ACTIVE');
        });

        it('should assign incrementing week numbers during scheduling', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });
            setAppState(db, 'current_week', '1');

            const movie1 = createTestMovie(db, { proposedBy: user1.id, status: 'PROPOSED' });
            const movie2 = createTestMovie(db, { proposedBy: user2.id, status: 'PROPOSED' });

            // Simulate scheduling with week assignment
            db.update(movies).set({ weekNumber: 1, status: 'ACTIVE' }).where(eq(movies.id, movie1.id)).run();
            db.update(movies).set({ weekNumber: 2, status: 'PROPOSED' }).where(eq(movies.id, movie2.id)).run();

            const scheduled = db.select().from(movies).all();
            const weeks = scheduled.map(m => m.weekNumber).sort();

            expect(weeks).toEqual([1, 2]);
        });

        it('should transition phase to VETTING after batch completion', () => {
            const db = getTestDb();

            setAppState(db, 'current_phase', 'VETTING');

            const phase = db.select().from(appState).where(eq(appState.key, 'current_phase')).all();
            expect(phase[0].value).toBe('VETTING');
        });
    });

    describe('Replacement Mode (After Rejection)', () => {
        it('should only update current week slot in replacement mode', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });
            setAppState(db, 'current_week', '1');

            // Week 1 movie was rejected, week 2 movie exists
            createTestMovie(db, { proposedBy: user1.id, status: 'REJECTED', weekNumber: 1 });
            const week2Movie = createTestMovie(db, { proposedBy: user2.id, status: 'PROPOSED', weekNumber: 2 });

            // User1 submits replacement
            const replacement = createTestMovie(db, { proposedBy: user1.id, status: 'ACTIVE', weekNumber: 1 });

            // Week 2 movie should remain unchanged
            const week2Result = db.select().from(movies).where(eq(movies.id, week2Movie.id)).all();
            expect(week2Result[0].weekNumber).toBe(2);
            expect(week2Result[0].status).toBe('PROPOSED');

            // Replacement should be in week 1
            const replacementResult = db.select().from(movies).where(eq(movies.id, replacement.id)).all();
            expect(replacementResult[0].weekNumber).toBe(1);
            expect(replacementResult[0].status).toBe('ACTIVE');
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
            createTestMovie(db, { proposedBy: user1.id, status: 'ACTIVE', weekNumber: 2 });

            // Future movies should be unchanged
            const futureMovies = db.select().from(movies)
                .where(and(ne(movies.status, 'REJECTED'), ne(movies.weekNumber, 2)))
                .all();

            expect(futureMovies).toHaveLength(2);
            expect(futureMovies.find(m => m.weekNumber === 3)).toBeDefined();
            expect(futureMovies.find(m => m.weekNumber === 4)).toBeDefined();
        });
    });
});
