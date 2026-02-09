import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { movies, users, appState, votes } from '@/db/schema';
import { eq, and, ne } from 'drizzle-orm';
import { submitMovie } from '@/lib/state-machine';

export async function GET(req: NextRequest) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Get current phase
    const phaseRaw = await db.select().from(appState).where(eq(appState.key, 'current_phase')).limit(1);
    const phase = phaseRaw[0]?.value || 'SUBMISSION';

    const weekRaw = await db.select().from(appState).where(eq(appState.key, 'current_week')).limit(1);
    const week = parseInt(weekRaw[0]?.value || '1');

    // Get my submission
    const mySubmission = await db.select().from(movies).where(and(
        eq(movies.proposedBy, session.user.id),
        ne(movies.status, 'COMPLETED'),
        ne(movies.status, 'REJECTED')
    )).limit(1);

    // Get stats
    const allUsers = await db.select().from(users);

    // Queue Masking Logic - only show PROPOSED movies in queue
    const rawQueue = await db.select().from(movies).where(eq(movies.status, 'PROPOSED'));

    const queue = rawQueue.map(m => {
        if (m.proposedBy === session.user.id) return m;

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
        stats: {
            submitted: activeOrProposed.length,
            totalUsers: allUsers.length
        },
        queue,
        history: historyWithScores
    });
}

export async function POST(req: NextRequest) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { title, coverUrl } = await req.json();

    try {
        await submitMovie(session.user.id, title, coverUrl);
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 400 });
    }
}
