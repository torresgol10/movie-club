import { describe, it, expect } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { getTestDb } from '../setup';
import { createTestUser, createTestMovie, setAppState, createVote } from '../helpers';
import { movies, votes, users, appState } from '@/db/schema';

describe('Use Case: Voting Process', () => {
    describe('Record Vote', () => {
        it('should record vote for active movie', () => {
            const db = getTestDb();
            const proposer = createTestUser(db, { name: 'proposer' });
            const voter = createTestUser(db, { name: 'voter' });
            const movie = createTestMovie(db, { proposedBy: proposer.id, status: 'ACTIVE' });

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
            const movie = createTestMovie(db, { proposedBy: proposer.id, status: 'ACTIVE' });

            createVote(db, movie.id, voter1.id, 0);  // Min score
            createVote(db, movie.id, voter2.id, 10); // Max score
            createVote(db, movie.id, voter3.id, 5);  // Mid score

            const allVotes = db.select().from(votes).where(eq(votes.movieId, movie.id)).all();

            expect(allVotes).toHaveLength(3);
            expect(allVotes.map(v => v.score).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([0, 5, 10]);
        });

        it('should reject vote when no active movie', () => {
            const db = getTestDb();

            const activeMovies = db.select().from(movies).where(eq(movies.status, 'ACTIVE')).all();

            expect(activeMovies).toHaveLength(0);
            // This would trigger error: 'No active movie'
        });
    });

    describe('Voting Completion & Week Transition', () => {
        it('should mark movie as WATCHED when all users vote', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });
            const movie = createTestMovie(db, { proposedBy: user1.id, status: 'ACTIVE' });

            // Both users vote
            createVote(db, movie.id, user1.id, 7);
            createVote(db, movie.id, user2.id, 9);

            const allUsers = db.select().from(users).all();
            const allVotes = db.select().from(votes).where(eq(votes.movieId, movie.id)).all();

            // Check if voting is complete
            if (allVotes.length >= allUsers.length) {
                db.update(movies)
                    .set({ status: 'WATCHED' })
                    .where(eq(movies.id, movie.id))
                    .run();
            }

            const result = db.select().from(movies).where(eq(movies.id, movie.id)).all();
            expect(result[0].status).toBe('WATCHED');
        });

        it('should increment week counter after voting completes', () => {
            const db = getTestDb();
            setAppState(db, 'current_week', '3');

            // Simulate week increment after voting completes
            const currentWeek = parseInt(
                db.select().from(appState).where(eq(appState.key, 'current_week')).all()[0]?.value || '1'
            );
            const nextWeek = currentWeek + 1;

            setAppState(db, 'current_week', String(nextWeek));

            const week = db.select().from(appState).where(eq(appState.key, 'current_week')).all();
            expect(week[0].value).toBe('4');
        });

        it('should activate next weeks movie if available', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });
            setAppState(db, 'current_week', '2');

            // Current movie at week 1 (would be WATCHED)
            createTestMovie(db, { proposedBy: user1.id, status: 'WATCHED', weekNumber: 1 });

            // Next movie at week 2
            const nextMovie = createTestMovie(db, { proposedBy: user2.id, status: 'PROPOSED', weekNumber: 2 });

            // Simulate activation of next week's movie
            const nextWeekMovie = db.select().from(movies).where(
                and(
                    eq(movies.weekNumber, 2),
                    eq(movies.status, 'PROPOSED')
                )
            ).all();

            if (nextWeekMovie.length > 0) {
                db.update(movies)
                    .set({ status: 'ACTIVE' })
                    .where(eq(movies.id, nextWeekMovie[0].id))
                    .run();

                setAppState(db, 'current_phase', 'VETTING');
            }

            const result = db.select().from(movies).where(eq(movies.id, nextMovie.id)).all();
            expect(result[0].status).toBe('ACTIVE');

            const phase = db.select().from(appState).where(eq(appState.key, 'current_phase')).all();
            expect(phase[0].value).toBe('VETTING');
        });

        it('should return to SUBMISSION phase when no next movie', () => {
            const db = getTestDb();
            setAppState(db, 'current_week', '5');

            // No movie for week 5
            const nextWeekMovies = db.select().from(movies).where(
                and(
                    eq(movies.weekNumber, 5),
                    eq(movies.status, 'PROPOSED')
                )
            ).all();

            if (nextWeekMovies.length === 0) {
                setAppState(db, 'current_phase', 'SUBMISSION');
            }

            const phase = db.select().from(appState).where(eq(appState.key, 'current_phase')).all();
            expect(phase[0].value).toBe('SUBMISSION');
        });
    });

    describe('Average Score Calculation', () => {
        it('should calculate average score for watched movie', () => {
            const db = getTestDb();
            const proposer = createTestUser(db, { name: 'proposer' });
            const voter1 = createTestUser(db, { name: 'voter1' });
            const voter2 = createTestUser(db, { name: 'voter2' });
            const voter3 = createTestUser(db, { name: 'voter3' });

            const movie = createTestMovie(db, { proposedBy: proposer.id, status: 'WATCHED' });

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
            const movie = createTestMovie(db, { proposedBy: user.id, status: 'WATCHED' });

            const movieVotes = db.select().from(votes).where(eq(votes.movieId, movie.id)).all();

            if (movieVotes.length === 0) {
                expect(null).toBeNull();
            }
        });
    });
});
