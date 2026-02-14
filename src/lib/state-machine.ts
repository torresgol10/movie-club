import { db } from '@/db';
import { appState, movies, users, votes, vettingResponses } from '@/db/schema';
import { eq, and, sql, count, lte, isNotNull, isNull, or } from 'drizzle-orm';
import { notifyNewVettingMovie, notifyMovieCompleted } from './push';

// New phases: SUBMISSION -> movies in PROPOSED/VETTING/WATCHING/COMPLETED states can coexist
// VETTING happens on schedule (e.g., every Monday) independent of voting completion
export type AppPhase = 'SUBMISSION' | 'ACTIVE';

export async function getAppState() {
    const phaseRecord = await db.select().from(appState).where(eq(appState.key, 'current_phase')).get();
    const weekRecord = await db.select().from(appState).where(eq(appState.key, 'current_week')).get();

    const phase = (phaseRecord?.value || 'SUBMISSION') as AppPhase;
    const week = parseInt(weekRecord?.value || '0');

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

    if (week > 0 && !rejectedSlot) {
        throw new Error('No replacement required for this user');
    }

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

        // Notify all users about the replacement movie in vetting
        notifyNewVettingMovie(title).catch(() => {});

        return;
    }

    const submissionWeekCondition = week > 0
        ? eq(movies.weekNumber, week)
        : or(isNull(movies.weekNumber), eq(movies.weekNumber, 0));

    const existing = await db.select().from(movies)
        .where(and(
            eq(movies.proposedBy, userId),
            eq(movies.status, 'PROPOSED'),
            submissionWeekCondition
        ))
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
            ...(week > 0 ? { weekNumber: week } : {}),
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

    let firstMovieTitle = '';
    for (let i = 0; i < shuffled.length; i++) {
        const vettingDate = new Date(nextMonday);
        vettingDate.setDate(nextMonday.getDate() + (i * 7)); // Each movie gets vetting one week apart

        const movieStatus = i === 0 ? 'VETTING' : 'PROPOSED';  // First movie starts vetting immediately
        if (i === 0) firstMovieTitle = shuffled[i].title;

        await db.update(movies)
            .set({
                weekNumber: i + 1,
                status: movieStatus,
                vettingStartDate: vettingDate
            })
            .where(eq(movies.id, shuffled[i].id));
    }

    // Notify all users about the first movie entering vetting
    if (firstMovieTitle) {
        notifyNewVettingMovie(firstMovieTitle).catch(() => {});
    }

    await db.insert(appState).values({ key: 'current_phase', value: 'ACTIVE' })
        .onConflictDoUpdate({ target: appState.key, set: { value: 'ACTIVE' } });

    await db.insert(appState).values({ key: 'current_week', value: '1' })
        .onConflictDoUpdate({ target: appState.key, set: { value: '1' } });
}

// Get movie currently in vetting phase
export async function getVettingMovie() {
    const { week } = await getAppState();

    return await db.select().from(movies)
        .where(and(
            eq(movies.weekNumber, week),
            sql`${movies.status} IN ('VETTING', 'PROPOSED')`
        ))
        .orderBy(movies.createdAt)
        .get();
}

// Intended to run from a scheduled job (cron), not from user read paths.
// Syncs current_week with calendar and opens vetting for the scheduled week.
export async function runWeeklyTransition() {
    const { phase, week } = await getAppState();
    if (phase !== 'ACTIVE') {
        return { phase, previousWeek: week, currentWeek: week, promotedMovieId: null as string | null };
    }

    const now = new Date();
    const scheduledWeekRes = await db.select({
        value: sql<number>`coalesce(max(${movies.weekNumber}), 0)`
    })
        .from(movies)
        .where(and(isNotNull(movies.vettingStartDate), lte(movies.vettingStartDate, now)))
        .get();

    const scheduledWeek = scheduledWeekRes?.value || week;
    const targetWeek = Math.max(week, scheduledWeek);

    if (targetWeek !== week) {
        await db.insert(appState).values({ key: 'current_week', value: String(targetWeek) })
            .onConflictDoUpdate({ target: appState.key, set: { value: String(targetWeek) } });
    }

    const anyVetting = await db.select().from(movies)
        .where(eq(movies.status, 'VETTING'))
        .get();

    if (anyVetting) {
        return { phase, previousWeek: week, currentWeek: targetWeek, promotedMovieId: null as string | null };
    }

    const scheduledMovie = await db.select().from(movies)
        .where(and(
            eq(movies.status, 'PROPOSED'),
            eq(movies.weekNumber, targetWeek),
            isNotNull(movies.vettingStartDate),
            lte(movies.vettingStartDate, now)
        ))
        .orderBy(movies.weekNumber)
        .limit(1)
        .get();

    if (!scheduledMovie) {
        return { phase, previousWeek: week, currentWeek: targetWeek, promotedMovieId: null as string | null };
    }

    await db.update(movies).set({ status: 'VETTING' }).where(eq(movies.id, scheduledMovie.id));

    // Notify all users about the new vetting movie
    notifyNewVettingMovie(scheduledMovie.title).catch(() => {});

    return { phase, previousWeek: week, currentWeek: targetWeek, promotedMovieId: scheduledMovie.id };
}

// Get movies that are currently being watched (passed vetting).
// Returns watching movies from current week AND previous weeks so users can
// still vote on late movies, but never exposes future-week movies.
export async function getWatchingMovies() {
    const { week } = await getAppState();

    return await db.select().from(movies)
        .where(and(eq(movies.status, 'WATCHING'), lte(movies.weekNumber, week)))
        .orderBy(movies.weekNumber)
        .all();
}

// Get movies pending vote from a specific user
export async function getPendingVotesForUser(userId: string) {
    const watchingMovies = await getWatchingMovies();
    const allUsersCount = (await db.select({ value: count() }).from(users).get())?.value || 0;
    const pendingMovies = [];

    for (const movie of watchingMovies) {
        // Ensure ALL users have completed vetting before allowing votes
        const vettingCount = (await db.select({ value: count() }).from(vettingResponses)
            .where(eq(vettingResponses.movieId, movie.id))
            .get())?.value || 0;

        if (vettingCount < allUsersCount) continue;

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

// Check if the next movie should start vetting.
// Two triggers: (1) the scheduled vettingStartDate has arrived, or
// (2) the current week's movie already finished vetting (WATCHING/COMPLETED)
//     so the group can move on early without waiting for the calendar date.
async function startNextVettingIfScheduled() {
    // Never start a second concurrent vetting
    const anyVetting = await db.select().from(movies)
        .where(eq(movies.status, 'VETTING'))
        .get();
    if (anyVetting) return;

    const { week } = await getAppState();
    const now = new Date();

    // Path 1: a PROPOSED movie whose scheduled date has already passed
    const scheduledMovie = await db.select().from(movies)
        .where(and(
            eq(movies.status, 'PROPOSED'),
            lte(movies.vettingStartDate, now)
        ))
        .orderBy(movies.weekNumber)
        .limit(1)
        .get();

    if (scheduledMovie) {
        await db.update(movies).set({ status: 'VETTING' }).where(eq(movies.id, scheduledMovie.id));
        notifyNewVettingMovie(scheduledMovie.title).catch(() => {});
        return;
    }

    // Path 2: current week's movie already moved past vetting → start next early
    const currentWeekPastVetting = await db.select().from(movies)
        .where(and(
            eq(movies.weekNumber, week),
            sql`${movies.status} IN ('WATCHING', 'COMPLETED')`
        ))
        .get();

    if (!currentWeekPastVetting) return;

    const nextMovie = await db.select().from(movies)
        .where(eq(movies.status, 'PROPOSED'))
        .orderBy(movies.weekNumber)
        .limit(1)
        .get();

    if (nextMovie) {
        // Promote and stamp vettingStartDate so getAppState() stays consistent
        await db.update(movies).set({
            status: 'VETTING',
            vettingStartDate: now
        }).where(eq(movies.id, nextMovie.id));

        notifyNewVettingMovie(nextMovie.title).catch(() => {});

        // Advance the week counter to match the promoted movie
        if (nextMovie.weekNumber && nextMovie.weekNumber > week) {
            await db.insert(appState)
                .values({ key: 'current_week', value: String(nextMovie.weekNumber) })
                .onConflictDoUpdate({ target: appState.key, set: { value: String(nextMovie.weekNumber) } });
        }
    }
}

export async function submitVote(userId: string, movieId: string, score: number) {
    const { week } = await getAppState();

    // Check that the movie is in WATCHING status and its week has already
    // started (week <= current). This lets late voters finish past weeks
    // while preventing votes on future-week movies.
    const movie = await db.select().from(movies)
        .where(and(
            eq(movies.id, movieId),
            eq(movies.status, 'WATCHING'),
            lte(movies.weekNumber, week)
        ))
        .get();

    if (!movie) throw new Error('Movie not available for voting');

    // Ensure ALL users have completed vetting before accepting votes
    const allUsersCount = (await db.select({ value: count() }).from(users).get())?.value || 0;
    const vettingCount = (await db.select({ value: count() }).from(vettingResponses)
        .where(eq(vettingResponses.movieId, movieId))
        .get())?.value || 0;

    if (vettingCount < allUsersCount) {
        throw new Error('Vetting not complete for this movie');
    }

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
    const voteCount = (await db.select({ value: count() }).from(votes)
        .where(eq(votes.movieId, movieId))
        .get())?.value || 0;

    if (voteCount >= allUsersCount) {
        // All users voted - mark as COMPLETED
        await db.update(movies).set({ status: 'COMPLETED' }).where(eq(movies.id, movieId));

        // Calculate average score and notify everyone
        const allVotes = await db.select().from(votes).where(eq(votes.movieId, movieId)).all();
        const avgScore = allVotes.reduce((sum, v) => sum + (v.score || 0), 0) / allVotes.length;
        notifyMovieCompleted(movie.title, avgScore).catch(() => {});

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
