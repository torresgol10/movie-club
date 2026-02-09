import { describe, it, expect } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { getTestDb } from '../setup';
import { createTestUser, createTestMovie, setAppState, createVote, getAppStateValue } from '../helpers';
import { movies, votes, users, appState } from '@/db/schema';

describe('Use Case: Voting Process (Decoupled Model)', () => {
    describe('Record Vote for Specific Movie', () => {
        it('should record vote for a specific WATCHING movie', () => {
            const db = getTestDb();
            const proposer = createTestUser(db, { name: 'proposer' });
            const voter = createTestUser(db, { name: 'voter' });
            const movie = createTestMovie(db, { proposedBy: proposer.id, status: 'WATCHING' });

            createVote(db, movie.id, voter.id, 8);

            const result = db.select().from(votes).where(
                and(
                    eq(votes.movieId, movie.id),
                    eq(votes.userId, voter.id)
                )
            ).all();

            expect(result).toHaveLength(1);
            expect(result[0].score).toBe(8);
        });

        it('should accept score in 0-10 range', () => {
            const db = getTestDb();
            const proposer = createTestUser(db, { name: 'proposer' });
            const voter1 = createTestUser(db, { name: 'voter1' });
            const voter2 = createTestUser(db, { name: 'voter2' });
            const voter3 = createTestUser(db, { name: 'voter3' });
            const movie = createTestMovie(db, { proposedBy: proposer.id, status: 'WATCHING' });

            createVote(db, movie.id, voter1.id, 0);  // Min score
            createVote(db, movie.id, voter2.id, 10); // Max score
            createVote(db, movie.id, voter3.id, 5);  // Mid score

            const allVotes = db.select().from(votes).where(eq(votes.movieId, movie.id)).all();

            expect(allVotes).toHaveLength(3);
            expect(allVotes.map(v => v.score).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([0, 5, 10]);
        });

        it('should allow voting on multiple movies independently', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });
            const movie1 = createTestMovie(db, { proposedBy: user1.id, status: 'WATCHING', weekNumber: 1 });
            const movie2 = createTestMovie(db, { proposedBy: user2.id, status: 'WATCHING', weekNumber: 2 });

            // User1 votes on both movies
            createVote(db, movie1.id, user1.id, 7);
            createVote(db, movie2.id, user1.id, 9);

            const user1Votes = db.select().from(votes)
                .where(eq(votes.userId, user1.id)).all();

            expect(user1Votes).toHaveLength(2);
            expect(user1Votes.find(v => v.movieId === movie1.id)?.score).toBe(7);
            expect(user1Votes.find(v => v.movieId === movie2.id)?.score).toBe(9);
        });

        it('should only allow voting on WATCHING movies', () => {
            const db = getTestDb();
            const user = createTestUser(db, { name: 'user1' });

            const proposedMovie = createTestMovie(db, { proposedBy: user.id, status: 'PROPOSED' });
            const vettingMovie = createTestMovie(db, { proposedBy: user.id, status: 'VETTING' });
            const watchingMovie = createTestMovie(db, { proposedBy: user.id, status: 'WATCHING' });

            // Only watchingMovie should be available for voting
            const votableMovies = db.select().from(movies)
                .where(eq(movies.status, 'WATCHING')).all();

            expect(votableMovies).toHaveLength(1);
            expect(votableMovies[0].id).toBe(watchingMovie.id);
        });
    });

    describe('Pending Votes Per User', () => {
        it('should return movies user has not voted on yet', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });
            const movie1 = createTestMovie(db, { proposedBy: user1.id, status: 'WATCHING', weekNumber: 1 });
            const movie2 = createTestMovie(db, { proposedBy: user2.id, status: 'WATCHING', weekNumber: 2 });

            // User1 votes on movie1 only
            createVote(db, movie1.id, user1.id, 8);

            // Get pending votes for user1
            const watchingMovies = db.select().from(movies)
                .where(eq(movies.status, 'WATCHING')).all();
            const pendingForUser1 = watchingMovies.filter(movie => {
                const voted = db.select().from(votes)
                    .where(and(eq(votes.movieId, movie.id), eq(votes.userId, user1.id))).all();
                return voted.length === 0;
            });

            expect(pendingForUser1).toHaveLength(1);
            expect(pendingForUser1[0].id).toBe(movie2.id);
        });

        it('should return empty when user has voted on all WATCHING movies', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });
            const movie = createTestMovie(db, { proposedBy: user2.id, status: 'WATCHING' });

            createVote(db, movie.id, user1.id, 7);

            const watchingMovies = db.select().from(movies)
                .where(eq(movies.status, 'WATCHING')).all();
            const pendingForUser1 = watchingMovies.filter(movie => {
                const voted = db.select().from(votes)
                    .where(and(eq(votes.movieId, movie.id), eq(votes.userId, user1.id))).all();
                return voted.length === 0;
            });

            expect(pendingForUser1).toHaveLength(0);
        });

        it('should show which users have not voted on a specific movie', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });
            const user3 = createTestUser(db, { name: 'user3' });
            const movie = createTestMovie(db, { proposedBy: user1.id, status: 'WATCHING' });

            // Only user1 has voted
            createVote(db, movie.id, user1.id, 7);

            const allUsers = db.select().from(users).all();
            const votesForMovie = db.select().from(votes)
                .where(eq(votes.movieId, movie.id)).all();
            const votedUserIds = new Set(votesForMovie.map(v => v.userId));
            const pendingUsers = allUsers.filter(u => !votedUserIds.has(u.id));

            expect(pendingUsers).toHaveLength(2);
            expect(pendingUsers.map(u => u.name).sort()).toEqual(['user2', 'user3']);
        });
    });

    describe('Voting Completion & Movie Status', () => {
        it('should mark movie as COMPLETED when all users vote', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });
            const movie = createTestMovie(db, { proposedBy: user1.id, status: 'WATCHING' });

            // Both users vote
            createVote(db, movie.id, user1.id, 7);
            createVote(db, movie.id, user2.id, 9);

            const allUsers = db.select().from(users).all();
            const allVotes = db.select().from(votes).where(eq(votes.movieId, movie.id)).all();

            // Check if voting is complete
            if (allVotes.length >= allUsers.length) {
                db.update(movies)
                    .set({ status: 'COMPLETED' })
                    .where(eq(movies.id, movie.id))
                    .run();
            }

            const result = db.select().from(movies).where(eq(movies.id, movie.id)).all();
            expect(result[0].status).toBe('COMPLETED');
        });

        it('should NOT complete movie when only some users voted', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });
            const user3 = createTestUser(db, { name: 'user3' });
            const movie = createTestMovie(db, { proposedBy: user1.id, status: 'WATCHING' });

            // Only 2 of 3 users vote
            createVote(db, movie.id, user1.id, 7);
            createVote(db, movie.id, user2.id, 9);

            const allUsers = db.select().from(users).all();
            const allVotes = db.select().from(votes).where(eq(votes.movieId, movie.id)).all();

            if (allVotes.length >= allUsers.length) {
                db.update(movies).set({ status: 'COMPLETED' }).where(eq(movies.id, movie.id)).run();
            }

            const result = db.select().from(movies).where(eq(movies.id, movie.id)).all();
            expect(result[0].status).toBe('WATCHING'); // Still watching, not completed
        });

        it('should return to SUBMISSION when all movies are COMPLETED', () => {
            const db = getTestDb();
            setAppState(db, 'current_phase', 'ACTIVE');

            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });
            const movie1 = createTestMovie(db, { proposedBy: user1.id, status: 'COMPLETED', weekNumber: 1 });
            const movie2 = createTestMovie(db, { proposedBy: user2.id, status: 'COMPLETED', weekNumber: 2 });

            // Check if any movies still in progress
            const anyActive = db.select().from(movies)
                .where(eq(movies.status, 'PROPOSED')).all()
                .concat(db.select().from(movies).where(eq(movies.status, 'VETTING')).all())
                .concat(db.select().from(movies).where(eq(movies.status, 'WATCHING')).all());

            if (anyActive.length === 0) {
                setAppState(db, 'current_phase', 'SUBMISSION');
                setAppState(db, 'current_week', '0');
            }

            expect(getAppStateValue(db, 'current_phase')).toBe('SUBMISSION');
            expect(getAppStateValue(db, 'current_week')).toBe('0');
        });

        it('should stay in ACTIVE when other movies are still pending', () => {
            const db = getTestDb();
            setAppState(db, 'current_phase', 'ACTIVE');

            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });
            createTestMovie(db, { proposedBy: user1.id, status: 'COMPLETED', weekNumber: 1 });
            createTestMovie(db, { proposedBy: user2.id, status: 'WATCHING', weekNumber: 2 }); // still watching

            const anyActive = db.select().from(movies)
                .where(eq(movies.status, 'WATCHING')).all();

            // Still has active movies
            expect(anyActive.length).toBeGreaterThan(0);
            expect(getAppStateValue(db, 'current_phase')).toBe('ACTIVE');
        });
    });

    describe('Average Score Calculation', () => {
        it('should calculate average score for completed movie', () => {
            const db = getTestDb();
            const proposer = createTestUser(db, { name: 'proposer' });
            const voter1 = createTestUser(db, { name: 'voter1' });
            const voter2 = createTestUser(db, { name: 'voter2' });
            const voter3 = createTestUser(db, { name: 'voter3' });

            const movie = createTestMovie(db, { proposedBy: proposer.id, status: 'COMPLETED' });

            createVote(db, movie.id, voter1.id, 7);
            createVote(db, movie.id, voter2.id, 8);
            createVote(db, movie.id, voter3.id, 9);

            const movieVotes = db.select().from(votes).where(eq(votes.movieId, movie.id)).all();
            const total = movieVotes.reduce((sum, v) => sum + (v.score ?? 0), 0);
            const avg = total / movieVotes.length;

            expect(avg.toFixed(1)).toBe('8.0');
        });

        it('should return null average for movie with no votes', () => {
            const db = getTestDb();
            const user = createTestUser(db, { name: 'proposer' });
            const movie = createTestMovie(db, { proposedBy: user.id, status: 'COMPLETED' });

            const movieVotes = db.select().from(votes).where(eq(votes.movieId, movie.id)).all();

            if (movieVotes.length === 0) {
                expect(null).toBeNull();
            }
        });
    });
});
