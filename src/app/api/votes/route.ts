import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { movies, votes, appState, users } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export async function POST(req: NextRequest) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { score } = await req.json();

    // Get active movie
    const activeMovie = await db.select().from(movies).where(eq(movies.status, 'ACTIVE')).limit(1);
    if (!activeMovie.length) return NextResponse.json({ error: 'No active movie' }, { status: 400 });

    // Record vote
    await db.insert(votes).values({
        id: uuidv4(),
        movieId: activeMovie[0].id,
        userId: session.user.id,
        score: score,
    });

    // Check if everyone has voted
    // If so, mark movie as WATCHED, increment week, set phase to SUBMISSION
    const allUsers = await db.select().from(users);
    const allVotes = await db.select().from(votes).where(eq(votes.movieId, activeMovie[0].id));

    if (allVotes.length >= allUsers.length) {
        await db.update(movies)
            .set({ status: 'WATCHED' })
            .where(eq(movies.id, activeMovie[0].id));

        // Next week
        const weekRaw = await db.select().from(appState).where(eq(appState.key, 'current_week')).limit(1);
        const nextWeek = parseInt(weekRaw[0]?.value || '1') + 1;

        await db.insert(appState).values({ key: 'current_week', value: String(nextWeek) })
            .onConflictDoUpdate({ target: appState.key, set: { value: String(nextWeek) } });

        // Check if there is a movie for the next week
        const nextMovie = await db.select().from(movies).where(and(
            eq(movies.weekNumber, nextWeek),
            // It should be PROPOSED or at least not REJECTED/WATCHED. 
            // In our logic, future movies are 'PROPOSED'.
            eq(movies.status, 'PROPOSED')
        )).limit(1);

        if (nextMovie.length > 0) {
            // Found next movie!
            await db.update(movies)
                .set({ status: 'ACTIVE' })
                .where(eq(movies.id, nextMovie[0].id));

            await db.insert(appState).values({ key: 'current_phase', value: 'VETTING' })
                .onConflictDoUpdate({ target: appState.key, set: { value: 'VETTING' } });
        } else {
            // No movie found for next week -> Batch finished.
            await db.insert(appState).values({ key: 'current_phase', value: 'SUBMISSION' })
                .onConflictDoUpdate({ target: appState.key, set: { value: 'SUBMISSION' } });
        }
    }

    return NextResponse.json({ success: true });
}
