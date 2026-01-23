import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db } from '@/db';
import { movies, users, appState, votes, vettingResponses } from '@/db/schema';
import { eq, and, ne } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

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
        ne(movies.status, 'WATCHED'),
        ne(movies.status, 'REJECTED')
    )).limit(1);

    // Get stats
    const allUsers = await db.select().from(users);

    // Queue Masking Logic
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
        and(ne(movies.status, 'WATCHED'), ne(movies.status, 'REJECTED'))
    );

    const history = await db.select().from(movies).where(
        eq(movies.status, 'WATCHED')
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

    // 1. Get Current Week
    const weekRaw = await db.select().from(appState).where(eq(appState.key, 'current_week')).limit(1);
    const week = parseInt(weekRaw[0]?.value || '1');

    // 2. Enforce Single Active/Proposed Limit
    const existing = await db.select().from(movies).where(and(
        eq(movies.proposedBy, session.user.id),
        ne(movies.status, 'WATCHED'),
        ne(movies.status, 'REJECTED')
    )).limit(1);

    if (existing.length > 0) {
        return NextResponse.json({ error: 'You already have a pending movie proposal.' }, { status: 400 });
    }

    // 3. Insert New Proposal (Always PROPOSED initially)
    const movieId = uuidv4();
    await db.insert(movies).values({
        id: movieId,
        title,
        coverUrl,
        proposedBy: session.user.id,
        weekNumber: week,
        status: 'PROPOSED'
    });

    // 4. CHECK IF BATCH IS COMPLETE
    const allUsers = await db.select().from(users);
    const currentBatch = await db.select().from(movies).where(and(
        ne(movies.status, 'WATCHED'),
        ne(movies.status, 'REJECTED')
    ));

    if (currentBatch.length >= allUsers.length) {
        // BATCH COMPLETE! Trigger Scheduling.

        // Check if this is a REPLACEMENT scenario (i.e. we already have a schedule)
        // We know schedule exists if any movie in the current batch has a weekNumber > currentWeek
        // (and presumably distinct).
        const hasFutureMovies = currentBatch.some(m => m.weekNumber !== null && m.weekNumber > week);

        if (hasFutureMovies) {
            // REPLACEMENT MODE: Only update the current week's movie
            // The new movie will naturally have weekNumber === week (from line 94-102)
            // and status === 'PROPOSED'. We need to make it ACTIVE.

            // Find the replacement candidate (the one for the current week)
            // (There should only be one non-rejected movie for the current week since we just filled the batch)
            const replacement = currentBatch.find(m => m.weekNumber === week);

            if (replacement) {
                await db.update(movies)
                    .set({ status: 'ACTIVE' })
                    .where(eq(movies.id, replacement.id));

                // Auto-register proposer's vetting response (they haven't seen their own pick)
                if (replacement.proposedBy) {
                    await db.insert(vettingResponses).values({
                        id: uuidv4(),
                        movieId: replacement.id,
                        userId: replacement.proposedBy,
                        response: 'NOT_SEEN'
                    });
                }
            }
        } else {
            // FRESH BATCH MODE: Shuffle and Assign

            // Shuffle the batch
            const shuffled = [...currentBatch];
            for (let i = shuffled.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
            }

            // Assign Weeks and Status
            for (let i = 0; i < shuffled.length; i++) {
                const m = shuffled[i];
                const targetWeek = week + i;
                const newStatus = i === 0 ? 'ACTIVE' : 'PROPOSED';

                await db.update(movies).set({
                    weekNumber: targetWeek,
                    status: newStatus
                }).where(eq(movies.id, m.id));

                // Auto-register vetting response for the first movie's proposer
                if (i === 0 && m.proposedBy) {
                    await db.insert(vettingResponses).values({
                        id: uuidv4(),
                        movieId: m.id,
                        userId: m.proposedBy,
                        response: 'NOT_SEEN'
                    });
                }
            }
        }

        // Set Phase to VETTING
        await db.insert(appState).values({ key: 'current_phase', value: 'VETTING' })
            .onConflictDoUpdate({ target: appState.key, set: { value: 'VETTING' } });
    }

    return NextResponse.json({ success: true });
}
