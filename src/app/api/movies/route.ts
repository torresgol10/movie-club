import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { db } from '@/db';
import { movies, users, votes } from '@/db/schema';
import { eq, and, ne, isNull, or } from 'drizzle-orm';
import { submitMovie, getAppState } from '@/lib/state-machine';

export async function GET(req: NextRequest) {
    const sessionUser = await getSessionUser();
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Use getAppState() so the week auto-advances based on the schedule
    const { phase, week } = await getAppState();
    const submissionWeekCondition = week > 0
        ? eq(movies.weekNumber, week)
        : or(isNull(movies.weekNumber), eq(movies.weekNumber, 0));

    // Get my submission
    const mySubmission = await db.select().from(movies).where(and(
        eq(movies.proposedBy, sessionUser.id),
        ne(movies.status, 'COMPLETED'),
        ne(movies.status, 'REJECTED'),
        submissionWeekCondition
    )).limit(1);

    // Rejected submission for the current week (so the user can re-submit)
    const rejectedSubmission = await db.select().from(movies).where(and(
        eq(movies.proposedBy, sessionUser.id),
        eq(movies.status, 'REJECTED'),
        eq(movies.weekNumber, week)
    )).orderBy(movies.weekNumber).limit(1);

    // Get stats
    const allUsers = await db.select().from(users);

    // Queue Masking Logic - only show PROPOSED movies in queue
    const rawQueue = await db.select().from(movies).where(eq(movies.status, 'PROPOSED'));

    const queue = rawQueue.map(m => {
        if (m.proposedBy === sessionUser.id) return m;

        return {
            ...m,
            title: 'Mystery Movie',
            description: '???',
            coverUrl: null,
            year: null
        };
    });

    const activeOrProposed = await db.select().from(movies).where(
        and(ne(movies.status, 'COMPLETED'), ne(movies.status, 'REJECTED'))
    );

    const history = await db.select().from(movies).where(
        eq(movies.status, 'COMPLETED')
    );

    // Calculate average scores
    const historyWithScores = await Promise.all(history.map(async (m) => {
        const movieVotes = await db.select().from(votes).where(eq(votes.movieId, m.id));
        if (movieVotes.length === 0) return { ...m, averageScore: null };

        const total = movieVotes.reduce((sum, v) => sum + (v.score || 0), 0);
        const avg = total / movieVotes.length;
        return { ...m, averageScore: avg.toFixed(1) };
    }));

    return NextResponse.json({
        state: { phase, week },
        mySubmission: mySubmission[0] || null,
        rejectedSubmission: rejectedSubmission[0] || null,
        stats: {
            submitted: activeOrProposed.length,
            totalUsers: allUsers.length
        },
        queue,
        history: historyWithScores
    });
}

export async function POST(req: NextRequest) {
    const sessionUser = await getSessionUser();
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { title, coverUrl } = await req.json();

    try {
        await submitMovie(sessionUser.id, title, coverUrl);
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 400 });
    }
}
