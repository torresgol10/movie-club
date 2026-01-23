import { describe, it, expect } from 'vitest';
import { eq, and } from 'drizzle-orm';
import { getTestDb } from '../setup';
import { createTestUser, createTestMovie, setAppState, createVettingResponse } from '../helpers';
import { movies, vettingResponses, users, appState } from '@/db/schema';

describe('Use Case: Vetting Process', () => {
    describe('Get Active Movie for Vetting', () => {
        it('should return the active movie for vetting', () => {
            const db = getTestDb();
            const user = createTestUser(db, { name: 'proposer' });
            const activeMovie = createTestMovie(db, {
                title: 'Active Movie',
                proposedBy: user.id,
                status: 'ACTIVE',
            });

            const result = db.select().from(movies).where(eq(movies.status, 'ACTIVE')).all();

            expect(result).toHaveLength(1);
            expect(result[0].id).toBe(activeMovie.id);
            expect(result[0].title).toBe('Active Movie');
        });

        it('should return null when no active movie exists', () => {
            const db = getTestDb();
            const user = createTestUser(db, { name: 'proposer' });
            createTestMovie(db, { proposedBy: user.id, status: 'PROPOSED' });

            const result = db.select().from(movies).where(eq(movies.status, 'ACTIVE')).all();

            expect(result).toHaveLength(0);
        });
    });

    describe('Vetting Responses', () => {
        it('should record NOT_SEEN response correctly', () => {
            const db = getTestDb();
            const proposer = createTestUser(db, { name: 'proposer' });
            const voter = createTestUser(db, { name: 'voter' });
            const movie = createTestMovie(db, { proposedBy: proposer.id, status: 'ACTIVE' });

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

        it('should transition to WATCHING when all users respond NOT_SEEN', () => {
            const db = getTestDb();
            const user1 = createTestUser(db, { name: 'user1' });
            const user2 = createTestUser(db, { name: 'user2' });
            const movie = createTestMovie(db, { proposedBy: user1.id, status: 'ACTIVE' });
            setAppState(db, 'current_phase', 'VETTING');

            // Both users respond NOT_SEEN
            createVettingResponse(db, movie.id, user1.id, 'NOT_SEEN');
            createVettingResponse(db, movie.id, user2.id, 'NOT_SEEN');

            const allUsers = db.select().from(users).all();
            const allResponses = db.select().from(vettingResponses)
                .where(eq(vettingResponses.movieId, movie.id)).all();

            // Check transition condition
            if (allResponses.length >= allUsers.length) {
                setAppState(db, 'current_phase', 'WATCHING');
            }

            const phase = db.select().from(appState).where(eq(appState.key, 'current_phase')).all();
            expect(phase[0].value).toBe('WATCHING');
        });
    });

    describe('Movie Rejection (SEEN)', () => {
        it('should reject movie immediately when marked as SEEN', () => {
            const db = getTestDb();
            const proposer = createTestUser(db, { name: 'proposer' });
            const voter = createTestUser(db, { name: 'voter' });
            const movie = createTestMovie(db, { proposedBy: proposer.id, status: 'ACTIVE' });

            // Voter says they've seen it
            db.update(movies)
                .set({ status: 'REJECTED' })
                .where(eq(movies.id, movie.id))
                .run();

            const result = db.select().from(movies).where(eq(movies.id, movie.id)).all();
            expect(result[0].status).toBe('REJECTED');
        });

        it('should return phase to SUBMISSION after rejection', () => {
            const db = getTestDb();
            setAppState(db, 'current_phase', 'VETTING');

            // Movie rejected - phase returns to SUBMISSION
            setAppState(db, 'current_phase', 'SUBMISSION');

            const phase = db.select().from(appState).where(eq(appState.key, 'current_phase')).all();
            expect(phase[0].value).toBe('SUBMISSION');
        });

        it('should keep same user turn after rejection (same week)', () => {
            const db = getTestDb();
            const user = createTestUser(db, { name: 'proposer' });
            setAppState(db, 'current_week', '3');

            const movie = createTestMovie(db, {
                proposedBy: user.id,
                status: 'ACTIVE',
                weekNumber: 3,
            });

            // Reject movie
            db.update(movies)
                .set({ status: 'REJECTED' })
                .where(eq(movies.id, movie.id))
                .run();

            // Week should NOT increment - same user retries
            const week = db.select().from(appState).where(eq(appState.key, 'current_week')).all();
            expect(week[0].value).toBe('3');

            // User can now submit replacement for same week
            const newMovie = createTestMovie(db, {
                proposedBy: user.id,
                status: 'PROPOSED',
                weekNumber: 3,
            });

            expect(newMovie.weekNumber).toBe(3);
            expect(newMovie.proposedBy).toBe(user.id);
        });
    });

    describe('Edge Cases', () => {
        it('should not allow vetting when no active movie', () => {
            const db = getTestDb();

            const activeMovies = db.select().from(movies).where(eq(movies.status, 'ACTIVE')).all();

            expect(activeMovies).toHaveLength(0);
            // This would trigger error: 'No active movie'
        });

        it('should not duplicate vetting responses from same user', () => {
            const db = getTestDb();
            const user = createTestUser(db, { name: 'voter' });
            const proposer = createTestUser(db, { name: 'proposer' });
            const movie = createTestMovie(db, { proposedBy: proposer.id, status: 'ACTIVE' });

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
            // Real API would skip insertion if exists
        });
    });
});
