import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { movies, appState, vettingResponses, users } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export async function GET(req: NextRequest) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // For simplicity, let's say the ACTIVE movie is the one being vetted or watched
    const activeMovie = await db.select().from(movies).where(
        and(eq(movies.status, 'ACTIVE'))
    ).limit(1);

    if (!activeMovie[0]) {
        return NextResponse.json({ movie: null, hasVetted: false, vettingProgress: null });
    }

    // Check if current user has already vetted
    const userVetting = await db.select().from(vettingResponses).where(
        and(
            eq(vettingResponses.movieId, activeMovie[0].id),
            eq(vettingResponses.userId, session.user.id)
        )
    ).limit(1);

    // Get vetting progress
    const allUsers = await db.select().from(users);
    const allResponses = await db.select().from(vettingResponses).where(
        eq(vettingResponses.movieId, activeMovie[0].id)
    );

    return NextResponse.json({
        movie: activeMovie[0],
        hasVetted: userVetting.length > 0,
        vettingProgress: {
            responded: allResponses.length,
            total: allUsers.length
        }
    });
}

export async function POST(req: NextRequest) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { seen } = await req.json();

    // Get active movie
    const activeMovie = await db.select().from(movies).where(eq(movies.status, 'ACTIVE')).limit(1);

    if (activeMovie.length === 0) {
        return NextResponse.json({ error: 'No active movie' }, { status: 400 });
    }

    const movieId = activeMovie[0].id;
    const userId = session.user.id;

    if (seen) {
        // REJECT LOGIC - Immediate Rejection
        await db.update(movies)
            .set({ status: 'REJECTED' })
            .where(eq(movies.id, movieId));

        await db.insert(appState).values({ key: 'current_phase', value: 'SUBMISSION' })
            .onConflictDoUpdate({ target: appState.key, set: { value: 'SUBMISSION' } });

    } else {
        // VOTE RECORDING
        const check = await db.select().from(vettingResponses).where(and(
            eq(vettingResponses.movieId, movieId),
            eq(vettingResponses.userId, userId)
        ));

        if (check.length === 0) {
            await db.insert(vettingResponses).values({
                id: uuidv4(),
                movieId: movieId,
                userId: userId,
                response: 'NOT_SEEN'
            });
        }

        // PHASE TRANSITION CHECK
        // If everyone has responded (implied NOT_SEEN since we aren't rejected), move to WATCHING
        const allUsers = await db.select().from(users);
        const allResponses = await db.select().from(vettingResponses).where(
            eq(vettingResponses.movieId, movieId)
        );

        if (allResponses.length >= allUsers.length) {
            await db.insert(appState).values({ key: 'current_phase', value: 'WATCHING' })
                .onConflictDoUpdate({ target: appState.key, set: { value: 'WATCHING' } });
        }
    }

    return NextResponse.json({ success: true });
}
