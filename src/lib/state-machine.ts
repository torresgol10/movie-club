import { db } from '@/db';
import { appState, movies, users, votes } from '@/db/schema';
import { eq, and, sql, count } from 'drizzle-orm';

export type AppPhase = 'SUBMISSION' | 'VETTING' | 'WATCHING' | 'VOTING';

export async function getAppState() {
    const phaseRecord = await db.select().from(appState).where(eq(appState.key, 'current_phase')).get();
    const weekRecord = await db.select().from(appState).where(eq(appState.key, 'current_week')).get();

    return {
        phase: (phaseRecord?.value || 'SUBMISSION') as AppPhase,
        week: parseInt(weekRecord?.value || '0'),
    };
}

export async function submitMovie(userId: string, title: string, coverUrl?: string) {
    const { phase } = await getAppState();
    if (phase !== 'SUBMISSION') throw new Error('Not int submission phase');

    const existing = await db.select().from(movies)
        .where(and(eq(movies.proposedBy, userId), eq(movies.status, 'PROPOSED')))
        .get();

    if (existing) {
        await db.update(movies).set({ title, coverUrl }).where(eq(movies.id, existing.id));
    } else {
        await db.insert(movies).values({
            id: crypto.randomUUID(),
            title,
            coverUrl,
            proposedBy: userId,
            status: 'PROPOSED',
        });
    }

    const allUsersRes = await db.select({ value: count() }).from(users).get();
    const submittedRes = await db.select({ value: count() }).from(movies).where(eq(movies.status, 'PROPOSED')).get();

    const userCount = allUsersRes?.value || 0;
    const submissions = submittedRes?.value || 0;

    if (submissions >= userCount && userCount > 0) {
        await scheduleMovies();
    }
}

async function scheduleMovies() {
    const props = await db.select().from(movies).where(eq(movies.status, 'PROPOSED')).all();
    const shuffled = props.sort(() => 0.5 - Math.random());

    for (let i = 0; i < shuffled.length; i++) {
        await db.update(movies)
            .set({ weekNumber: i + 1, status: 'QUEUED' })
            .where(eq(movies.id, shuffled[i].id));
    }

    await db.insert(appState).values({ key: 'current_phase', value: 'VETTING' })
        .onConflictDoUpdate({ target: appState.key, set: { value: 'VETTING' } });

    await db.insert(appState).values({ key: 'current_week', value: '1' })
        .onConflictDoUpdate({ target: appState.key, set: { value: '1' } });
}

export async function getActiveMovie() {
    const { week } = await getAppState();
    if (week === 0) return null;

    return await db.select().from(movies)
        .where(and(eq(movies.weekNumber, week), eq(movies.status, 'QUEUED')))
        .get();
}

export async function submitVetting(userId: string, seen: boolean) {
    const movie = await getActiveMovie();
    if (!movie) throw new Error('No active movie');

    if (seen) {
        await db.update(movies).set({ status: 'REJECTED' }).where(eq(movies.id, movie.id));
    } else {
        await db.insert(votes).values({
            id: crypto.randomUUID(),
            userId,
            movieId: movie.id,
            score: 0,
            comment: 'VETTING_NOT_SEEN'
        });

        const allUsersCount = (await db.select({ value: count() }).from(users).get())?.value || 0;
        const notSeenCount = (await db.select({ value: count() }).from(votes)
            .where(and(eq(votes.movieId, movie.id), eq(votes.comment, 'VETTING_NOT_SEEN')))
            .get())?.value || 0;

        if (notSeenCount >= allUsersCount) {
            await db.update(appState).set({ value: 'WATCHING' }).where(eq(appState.key, 'current_phase'));
        }
    }
}

export async function submitVote(userId: string, score: number) {
    const { phase } = await getAppState();
    if (phase !== 'WATCHING') throw new Error('Not in voting Phase');

    const movie = await getActiveMovie();
    if (!movie) throw new Error('No active movie');

    const existing = await db.select().from(votes)
        .where(and(eq(votes.movieId, movie.id), eq(votes.userId, userId), eq(votes.comment, 'RATING')))
        .get();

    if (existing) {
        await db.update(votes).set({ score }).where(eq(votes.id, existing.id));
    } else {
        await db.insert(votes).values({
            id: crypto.randomUUID(),
            userId,
            movieId: movie.id,
            score,
            comment: 'RATING'
        });
    }

    const allUsersCount = (await db.select({ value: count() }).from(users).get())?.value || 0;
    const voteCount = (await db.select({ value: count() }).from(votes)
        .where(and(eq(votes.movieId, movie.id), eq(votes.comment, 'RATING')))
        .get())?.value || 0;

    if (voteCount >= allUsersCount) {
        await db.update(movies).set({ status: 'COMPLETED' }).where(eq(movies.id, movie.id));

        const currentWeekVal = (await db.select().from(appState).where(eq(appState.key, 'current_week')).get())?.value || '0';
        const nextWeek = parseInt(currentWeekVal) + 1;

        await db.update(appState).set({ value: nextWeek.toString() }).where(eq(appState.key, 'current_week'));

        const nextMovie = await db.select().from(movies)
            .where(and(eq(movies.weekNumber, nextWeek), eq(movies.status, 'QUEUED')))
            .get();

        if (nextMovie) {
            await db.update(appState).set({ value: 'VETTING' }).where(eq(appState.key, 'current_phase'));
        } else {
            await db.update(appState).set({ value: 'SUBMISSION' }).where(eq(appState.key, 'current_phase'));
            await db.update(appState).set({ value: '0' }).where(eq(appState.key, 'current_week'));
        }
    }
}
