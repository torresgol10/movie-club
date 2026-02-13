import { db } from '@/db';
import { appState, movies, users, votes, vettingResponses } from '@/db/schema';
import { eq, and, sql, count, lte, isNotNull } from 'drizzle-orm';

// New phases: SUBMISSION -> movies in PROPOSED/VETTING/WATCHING/COMPLETED states can coexist
// VETTING happens on schedule (e.g., every Monday) independent of voting completion
export type AppPhase = 'SUBMISSION' | 'ACTIVE';

export async function getAppState() {
    const phaseRecord = await db.select().from(appState).where(eq(appState.key, 'current_phase')).get();
    const weekRecord = await db.select().from(appState).where(eq(appState.key, 'current_week')).get();

    const phase = (phaseRecord?.value || 'SUBMISSION') as AppPhase;
    let week = parseInt(weekRecord?.value || '0');

    if (phase === 'ACTIVE') {
        const now = new Date();
        const scheduledWeekRes = await db.select({
            value: sql<number>`coalesce(max(${movies.weekNumber}), 0)`
        })
            .from(movies)
            .where(and(isNotNull(movies.vettingStartDate), lte(movies.vettingStartDate, now)))
            .get();

        const scheduledWeek = scheduledWeekRes?.value || 0;
        const syncedWeek = Math.max(week, scheduledWeek);

        if (syncedWeek !== week) {
            await db.insert(appState).values({ key: 'current_week', value: String(syncedWeek) })
                .onConflictDoUpdate({ target: appState.key, set: { value: String(syncedWeek) } });
            week = syncedWeek;
        }
    }

    return {
        phase,
        week,
    };
}

export async function submitMovie(userId: string, title: string, coverUrl?: string) {
    const { phase, week } = await getAppState();
    if (phase !== 'SUBMISSION') throw new Error('Not in submission phase');

    const rejectedSlot = await db.select().from(movies)
        .where(and(
            eq(movies.proposedBy, userId),
            eq(movies.status, 'REJECTED'),
            eq(movies.weekNumber, week)
        ))
        .get();

    if (rejectedSlot) {
        const currentWeekVetting = await db.select().from(movies)
            .where(and(eq(movies.status, 'VETTING'), eq(movies.weekNumber, week)))
            .get();

        if (currentWeekVetting) {
            throw new Error('Current week already has a movie in vetting');
        }

        await db.insert(movies).values({
            id: crypto.randomUUID(),
            title,
            coverUrl,
            proposedBy: userId,
            status: 'VETTING',
            weekNumber: week,
            vettingStartDate: new Date(),
        });

        await db.insert(appState).values({ key: 'current_phase', value: 'ACTIVE' })
            .onConflictDoUpdate({ target: appState.key, set: { value: 'ACTIVE' } });

        return;
    }

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

    // Calculate vetting dates - start next Monday, then every Monday after
    const now = new Date();
    const nextMonday = new Date(now);
    nextMonday.setDate(now.getDate() + ((1 + 7 - now.getDay()) % 7 || 7));
    nextMonday.setHours(0, 0, 0, 0);

    for (let i = 0; i < shuffled.length; i++) {
        const vettingDate = new Date(nextMonday);
        vettingDate.setDate(nextMonday.getDate() + (i * 7)); // Each movie gets vetting one week apart

        const movieStatus = i === 0 ? 'VETTING' : 'PROPOSED';  // First movie starts vetting immediately

        await db.update(movies)
            .set({
                weekNumber: i + 1,
                status: movieStatus,
                vettingStartDate: vettingDate
            })
            .where(eq(movies.id, shuffled[i].id));
    }

    await db.insert(appState).values({ key: 'current_phase', value: 'ACTIVE' })
        .onConflictDoUpdate({ target: appState.key, set: { value: 'ACTIVE' } });

    await db.insert(appState).values({ key: 'current_week', value: '1' })
        .onConflictDoUpdate({ target: appState.key, set: { value: '1' } });
}

// Get movie currently in vetting phase
export async function getVettingMovie() {
    await startNextVettingIfScheduled();
    const { week } = await getAppState();

    return await db.select().from(movies)
        .where(and(eq(movies.status, 'VETTING'), eq(movies.weekNumber, week)))
        .orderBy(movies.createdAt)
        .get();
}

// Get movies that are currently being watched (passed vetting)
export async function getWatchingMovies() {
    const { week } = await getAppState();

    return await db.select().from(movies)
        .where(and(eq(movies.status, 'WATCHING'), eq(movies.weekNumber, week)))
        .all();
}

// Get movies pending vote from a specific user
export async function getPendingVotesForUser(userId: string) {
    const watchingMovies = await getWatchingMovies();
    const pendingMovies = [];

    for (const movie of watchingMovies) {
        const existingVote = await db.select().from(votes)
            .where(and(eq(votes.movieId, movie.id), eq(votes.userId, userId)))
            .get();

        if (!existingVote) {
            pendingMovies.push(movie);
        }
    }

    return pendingMovies;
}

// Get users who haven't voted on a specific movie
export async function getUsersPendingVoteForMovie(movieId: string) {
    const allUsers = await db.select().from(users).all();
    const votes_for_movie = await db.select().from(votes).where(eq(votes.movieId, movieId)).all();
    const votedUserIds = new Set(votes_for_movie.map(v => v.userId));

    return allUsers.filter(u => !votedUserIds.has(u.id));
}

// Get users who haven't vetted the current vetting movie
export async function getUsersPendingVetting(movieId: string) {
    const allUsers = await db.select().from(users).all();
    const responses = await db.select().from(vettingResponses).where(eq(vettingResponses.movieId, movieId)).all();
    const respondedUserIds = new Set(responses.map(r => r.userId));

    return allUsers.filter(u => !respondedUserIds.has(u.id));
}

export async function submitVetting(userId: string, seen: boolean) {
    const movie = await getVettingMovie();
    if (!movie) throw new Error('No movie in vetting phase');

    if (seen) {
        // Movie is rejected - mark as REJECTED and return to SUBMISSION for that slot
        await db.update(movies).set({ status: 'REJECTED' }).where(eq(movies.id, movie.id));

        await db.update(appState).set({ value: 'SUBMISSION' }).where(eq(appState.key, 'current_phase'));
    } else {
        // User hasn't seen it - record response
        await db.insert(vettingResponses).values({
            id: crypto.randomUUID(),
            userId,
            movieId: movie.id,
            response: 'NOT_SEEN'
        }).onConflictDoNothing();

        // Check if all users have responded
        const allUsersCount = (await db.select({ value: count() }).from(users).get())?.value || 0;
        const notSeenCount = (await db.select({ value: count() }).from(vettingResponses)
            .where(eq(vettingResponses.movieId, movie.id))
            .get())?.value || 0;

        if (notSeenCount >= allUsersCount) {
            // All users confirmed they haven't seen it - move to WATCHING
            await db.update(movies).set({ status: 'WATCHING' }).where(eq(movies.id, movie.id));
        }
    }
}

// Check if the next movie should start vetting based on schedule
async function startNextVettingIfScheduled() {
    const { week } = await getAppState();
    const now = new Date();

    const currentWeekInProgress = await db.select().from(movies)
        .where(and(
            eq(movies.weekNumber, week),
            sql`${movies.status} IN ('VETTING', 'WATCHING')`
        ))
        .get();

    if (currentWeekInProgress) {
        return;
    }

    const anyVetting = await db.select().from(movies)
        .where(eq(movies.status, 'VETTING'))
        .get();

    if (anyVetting) {
        return;
    }

    // Find the next movie that should be in vetting but isn't yet
    const nextMovie = await db.select().from(movies)
        .where(and(
            eq(movies.status, 'PROPOSED'),
            eq(movies.weekNumber, week),
            lte(movies.vettingStartDate, now)
        ))
        .orderBy(movies.weekNumber)
        .limit(1)
        .get();

    if (nextMovie) {
        await db.update(movies).set({ status: 'VETTING' }).where(eq(movies.id, nextMovie.id));
    }
}

export async function submitVote(userId: string, movieId: string, score: number) {
    const { phase, week } = await getAppState();
    if (phase !== 'ACTIVE') throw new Error('Not in active phase');

    // Check that the movie is in WATCHING status
    const movie = await db.select().from(movies)
        .where(and(
            eq(movies.id, movieId),
            eq(movies.status, 'WATCHING'),
            eq(movies.weekNumber, week)
        ))
        .get();

    if (!movie) throw new Error('Movie not available for voting');

    // Check if user already voted
    const existing = await db.select().from(votes)
        .where(and(eq(votes.movieId, movieId), eq(votes.userId, userId)))
        .get();

    if (existing) {
        // Update existing vote
        await db.update(votes).set({ score }).where(eq(votes.id, existing.id));
    } else {
        // Insert new vote
        await db.insert(votes).values({
            id: crypto.randomUUID(),
            userId,
            movieId,
            score,
        });
    }

    // Check if all users have voted on this movie
    const allUsersCount = (await db.select({ value: count() }).from(users).get())?.value || 0;
    const voteCount = (await db.select({ value: count() }).from(votes)
        .where(eq(votes.movieId, movieId))
        .get())?.value || 0;

    if (voteCount >= allUsersCount) {
        // All users voted - mark as COMPLETED
        await db.update(movies).set({ status: 'COMPLETED' }).where(eq(movies.id, movieId));

        await startNextVettingIfScheduled();

        // Check if all movies in the batch are completed
        const anyActiveMovies = await db.select().from(movies)
            .where(and(
                sql`${movies.status} IN ('PROPOSED', 'VETTING', 'WATCHING')`
            ))
            .all();

        if (anyActiveMovies.length === 0) {
            // All movies completed - return to SUBMISSION
            await db.update(appState).set({ value: 'SUBMISSION' }).where(eq(appState.key, 'current_phase'));
            await db.update(appState).set({ value: '0' }).where(eq(appState.key, 'current_week'));
        }
    }
}
