import { describe, it, expect, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { getTestDb } from '../setup';
import { createTestMovie, createTestUser, getAppStateValue, setAppState } from '../helpers';
import { appState, movies } from '@/db/schema';

async function loadStateMachine() {
    vi.resetModules();
    vi.doMock('@/db', () => ({ db: getTestDb() }));
    return await import('@/lib/state-machine');
}

describe('State Machine: Weekly Guardrails', () => {
    it('rejecting a vetting movie returns to SUBMISSION and does not open next week movie', async () => {
        const db = getTestDb();
        const user1 = createTestUser(db, { name: 'user1' });
        const user2 = createTestUser(db, { name: 'user2' });

        setAppState(db, 'current_phase', 'ACTIVE');
        setAppState(db, 'current_week', '1');

        const week1Movie = createTestMovie(db, {
            proposedBy: user1.id,
            status: 'VETTING',
            weekNumber: 1,
            vettingStartDate: new Date(Date.now() - 86400000),
        });

        const week2Movie = createTestMovie(db, {
            proposedBy: user2.id,
            status: 'PROPOSED',
            weekNumber: 2,
            vettingStartDate: new Date(Date.now() + 7 * 86400000),
        });

        const { submitVetting } = await loadStateMachine();
        await submitVetting(user2.id, true);

        const rejected = db.select().from(movies).where(eq(movies.id, week1Movie.id)).all()[0];
        const future = db.select().from(movies).where(eq(movies.id, week2Movie.id)).all()[0];

        expect(rejected.status).toBe('REJECTED');
        expect(getAppStateValue(db, 'current_phase')).toBe('SUBMISSION');
        expect(future.status).toBe('PROPOSED');
    });

    it('replacement submission creates a new VETTING movie in same week and reactivates phase', async () => {
        const db = getTestDb();
        const user1 = createTestUser(db, { name: 'owner-week-1' });
        const user2 = createTestUser(db, { name: 'owner-week-2' });

        setAppState(db, 'current_phase', 'SUBMISSION');
        setAppState(db, 'current_week', '1');

        createTestMovie(db, {
            proposedBy: user1.id,
            status: 'REJECTED',
            weekNumber: 1,
        });

        const week2Movie = createTestMovie(db, {
            proposedBy: user2.id,
            status: 'PROPOSED',
            weekNumber: 2,
        });

        const { submitMovie } = await loadStateMachine();
        await submitMovie(user1.id, 'Replacement Movie', 'https://example.com/cover.jpg');

        const replacement = db.select().from(movies).where(and(
            eq(movies.proposedBy, user1.id),
            eq(movies.status, 'VETTING'),
            eq(movies.weekNumber, 1)
        )).all();

        const future = db.select().from(movies).where(eq(movies.id, week2Movie.id)).all()[0];

        expect(replacement).toHaveLength(1);
        expect(replacement[0].title).toBe('Replacement Movie');
        expect(getAppStateValue(db, 'current_phase')).toBe('ACTIVE');
        expect(future.status).toBe('PROPOSED');
    });

    it('does not open next vetting after all NOT_SEEN responses in current week', async () => {
        const db = getTestDb();
        const user1 = createTestUser(db, { name: 'user1' });
        const user2 = createTestUser(db, { name: 'user2' });

        setAppState(db, 'current_phase', 'ACTIVE');
        setAppState(db, 'current_week', '1');

        const week1Movie = createTestMovie(db, {
            proposedBy: user1.id,
            status: 'VETTING',
            weekNumber: 1,
            vettingStartDate: new Date(Date.now() - 86400000),
        });

        const week2Movie = createTestMovie(db, {
            proposedBy: user2.id,
            status: 'PROPOSED',
            weekNumber: 2,
            vettingStartDate: new Date(Date.now() + 7 * 86400000),
        });

        const { submitVetting } = await loadStateMachine();
        await submitVetting(user1.id, false);
        await submitVetting(user2.id, false);

        const current = db.select().from(movies).where(eq(movies.id, week1Movie.id)).all()[0];
        const future = db.select().from(movies).where(eq(movies.id, week2Movie.id)).all()[0];

        expect(current.status).toBe('WATCHING');
        expect(future.status).toBe('PROPOSED');
    });

    it('completing votes does not advance week by itself', async () => {
        const db = getTestDb();
        const user1 = createTestUser(db, { name: 'user1' });
        const user2 = createTestUser(db, { name: 'user2' });

        setAppState(db, 'current_phase', 'ACTIVE');
        setAppState(db, 'current_week', '1');

        const week1Movie = createTestMovie(db, {
            proposedBy: user1.id,
            status: 'WATCHING',
            weekNumber: 1,
            vettingStartDate: new Date(Date.now() - 86400000),
        });

        createTestMovie(db, {
            proposedBy: user2.id,
            status: 'PROPOSED',
            weekNumber: 2,
            vettingStartDate: new Date(Date.now() + 7 * 86400000),
        });

        const { submitVote } = await loadStateMachine();
        await submitVote(user1.id, week1Movie.id, 7);

        let currentWeek = db.select().from(appState).where(eq(appState.key, 'current_week')).all()[0];
        expect(currentWeek.value).toBe('1');

        await submitVote(user2.id, week1Movie.id, 9);

        const completed = db.select().from(movies).where(eq(movies.id, week1Movie.id)).all()[0];
        currentWeek = db.select().from(appState).where(eq(appState.key, 'current_week')).all()[0];

        expect(completed.status).toBe('COMPLETED');
        expect(currentWeek.value).toBe('1');
    });

    it('advances current week on schedule and opens vetting for that week', async () => {
        const db = getTestDb();
        const user1 = createTestUser(db, { name: 'user1' });
        const user2 = createTestUser(db, { name: 'user2' });

        setAppState(db, 'current_phase', 'ACTIVE');
        setAppState(db, 'current_week', '1');

        createTestMovie(db, {
            proposedBy: user1.id,
            status: 'WATCHING',
            weekNumber: 1,
            vettingStartDate: new Date(Date.now() - 14 * 86400000),
        });

        const week2Movie = createTestMovie(db, {
            proposedBy: user2.id,
            status: 'PROPOSED',
            weekNumber: 2,
            vettingStartDate: new Date(Date.now() - 86400000),
        });

        const { getAppState, getVettingMovie } = await loadStateMachine();
        const state = await getAppState();
        const vettingMovie = await getVettingMovie();

        expect(state.week).toBe(2);
        expect(vettingMovie?.id).toBe(week2Movie.id);

        const persistedWeek = db.select().from(appState).where(eq(appState.key, 'current_week')).all()[0];
        expect(persistedWeek.value).toBe('2');
    });

    it('allows votes for past-week watching movies but rejects future-week ones', async () => {
        const db = getTestDb();
        const user1 = createTestUser(db, { name: 'user1' });

        setAppState(db, 'current_phase', 'ACTIVE');
        setAppState(db, 'current_week', '2');

        // Past-week movie (week 1, current is 2) -> should be allowed
        const pastWeekMovie = createTestMovie(db, {
            proposedBy: user1.id,
            status: 'WATCHING',
            weekNumber: 1,
        });

        // Future-week movie (week 3, current is 2) -> should be rejected
        const futureWeekMovie = createTestMovie(db, {
            proposedBy: user1.id,
            status: 'WATCHING',
            weekNumber: 3,
        });

        const { submitVote } = await loadStateMachine();

        // Past week: should succeed
        await submitVote(user1.id, pastWeekMovie.id, 8);

        // Future week: should fail
        await expect(submitVote(user1.id, futureWeekMovie.id, 8)).rejects.toThrow('Movie not available for voting');
    });

    it('returns watching movies from current and past weeks but not future weeks', async () => {
        const db = getTestDb();
        const user1 = createTestUser(db, { name: 'user1' });
        const user2 = createTestUser(db, { name: 'user2' });

        setAppState(db, 'current_phase', 'ACTIVE');
        setAppState(db, 'current_week', '2');

        const week2Vetting = createTestMovie(db, {
            proposedBy: user1.id,
            status: 'VETTING',
            weekNumber: 2,
        });

        createTestMovie(db, {
            proposedBy: user2.id,
            status: 'VETTING',
            weekNumber: 3,
        });

        const week2Watching = createTestMovie(db, {
            proposedBy: user2.id,
            status: 'WATCHING',
            weekNumber: 2,
        });

        const week1Watching = createTestMovie(db, {
            proposedBy: user1.id,
            status: 'WATCHING',
            weekNumber: 1,
        });

        // Future-week movie that should NOT appear
        createTestMovie(db, {
            proposedBy: user1.id,
            status: 'WATCHING',
            weekNumber: 3,
        });

        const { getVettingMovie, getWatchingMovies } = await loadStateMachine();

        const vetting = await getVettingMovie();
        const watching = await getWatchingMovies();

        expect(vetting?.id).toBe(week2Vetting.id);
        // Only week 1 and week 2 watching movies (not week 3)
        expect(watching).toHaveLength(2);
        const watchingIds = watching.map((m: any) => m.id);
        expect(watchingIds).toContain(week2Watching.id);
        expect(watchingIds).toContain(week1Watching.id);
    });

    it('week transition: late voter can still vote AND up-to-date users see new vetting', async () => {
        const db = getTestDb();
        const user1 = createTestUser(db, { name: 'late-voter' });
        const user2 = createTestUser(db, { name: 'up-to-date' });

        setAppState(db, 'current_phase', 'ACTIVE');
        setAppState(db, 'current_week', '1');

        // Week 1 movie: already passed vetting, in WATCHING, user1 hasn't voted
        const week1Movie = createTestMovie(db, {
            proposedBy: user1.id,
            status: 'WATCHING',
            weekNumber: 1,
            vettingStartDate: new Date(Date.now() - 14 * 86400000),
        });

        // Week 2 movie: its vettingStartDate has already passed (new week started)
        const week2Movie = createTestMovie(db, {
            proposedBy: user2.id,
            status: 'PROPOSED',
            weekNumber: 2,
            vettingStartDate: new Date(Date.now() - 86400000),
        });

        const { getAppState, getVettingMovie, getPendingVotesForUser, submitVote } = await loadStateMachine();

        // Week should auto-advance to 2
        const state = await getAppState();
        expect(state.week).toBe(2);

        // Up-to-date user should see the new vetting movie
        const vetting = await getVettingMovie();
        expect(vetting?.id).toBe(week2Movie.id);
        expect(vetting?.status).toBe('VETTING');

        // Late voter should still see week 1 movie in pending votes
        const pending = await getPendingVotesForUser(user1.id);
        expect(pending).toHaveLength(1);
        expect(pending[0].id).toBe(week1Movie.id);

        // Late voter should be able to vote on week 1 movie
        await submitVote(user1.id, week1Movie.id, 7);
        await submitVote(user2.id, week1Movie.id, 9);

        // After all votes, week 1 movie should be COMPLETED
        const completed = db.select().from(movies).where(eq(movies.id, week1Movie.id)).all()[0];
        expect(completed.status).toBe('COMPLETED');
    });
});
