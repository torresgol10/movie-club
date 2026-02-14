import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { users, votes, vettingResponses } from '@/db/schema';
import { eq, count } from 'drizzle-orm';
import { getAppState, getVettingMovie, getUsersPendingVetting, getWatchingMovies } from '@/lib/state-machine';
import { notifyPendingVetting, notifyPendingVotes } from '@/lib/push';

function isAuthorized(req: NextRequest) {
    const secret = process.env.CRON_SECRET;
    if (!secret) return true;

    const authHeader = req.headers.get('authorization');
    if (authHeader === `Bearer ${secret}`) return true;

    const secretParam = req.nextUrl.searchParams.get('secret');
    if (secretParam === secret) return true;

    return false;
}

export async function GET(req: NextRequest) {
    if (!isAuthorized(req)) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const results: { vettingReminders: number; voteReminders: number } = {
        vettingReminders: 0,
        voteReminders: 0,
    };

    try {
        // 1. Remind users who haven't responded to vetting
        const vettingMovie = await getVettingMovie();
        if (vettingMovie) {
            const pendingUsers = await getUsersPendingVetting(vettingMovie.id);
            if (pendingUsers.length > 0) {
                await notifyPendingVetting(
                    pendingUsers.map(u => u.id),
                    vettingMovie.title
                );
                results.vettingReminders = pendingUsers.length;
            }
        }

        // 2. Remind users who haven't voted on movies that entered WATCHING 2+ days ago
        await getAppState();
        const watchingMovies = await getWatchingMovies();
        const now = new Date();
        const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
        const allUsersCount = (await db.select({ value: count() }).from(users).get())?.value || 0;

        for (const movie of watchingMovies) {
            // Check if vetting is complete (prerequisite for voting)
            const vettingCount = (await db.select({ value: count() }).from(vettingResponses)
                .where(eq(vettingResponses.movieId, movie.id))
                .get())?.value || 0;
            if (vettingCount < allUsersCount) continue;

            // Find out when the movie entered WATCHING status.
            // We approximate this with vettingStartDate since it transitions
            // shortly after vetting opens. If the movie has been watchable for
            // less than 2 days, skip the reminder.
            const vettingStart = movie.vettingStartDate;
            if (vettingStart && new Date(vettingStart) > twoDaysAgo) continue;

            // Get users who haven't voted
            const allUsers = await db.select().from(users).all();
            const movieVotes = await db.select().from(votes).where(eq(votes.movieId, movie.id)).all();
            const votedUserIds = new Set(movieVotes.map(v => v.userId));
            const pendingUsers = allUsers.filter(u => !votedUserIds.has(u.id));

            if (pendingUsers.length > 0) {
                await notifyPendingVotes(
                    pendingUsers.map(u => u.id),
                    movie.title
                );
                results.voteReminders += pendingUsers.length;
            }
        }

        return NextResponse.json({ success: true, ...results });
    } catch (error) {
        return NextResponse.json({
            success: false,
            error: (error as Error).message,
        }, { status: 500 });
    }
}
