import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { getVettingMovie, getUsersPendingVetting, submitVetting } from '@/lib/state-machine';

export async function GET(req: NextRequest) {
    const sessionUser = await getSessionUser();
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const vettingMovie = await getVettingMovie();

    if (!vettingMovie) {
        return NextResponse.json({ movie: null, hasVetted: false, pendingUsers: [] });
    }

    // Check if current user has already vetted
    const { vettingResponses } = await import('@/db/schema');
    const { db } = await import('@/db');
    const { and, eq } = await import('drizzle-orm');

    const userVetting = await db.select().from(vettingResponses).where(
        and(
            eq(vettingResponses.movieId, vettingMovie.id),
            eq(vettingResponses.userId, sessionUser.id)
        )
    ).limit(1);

    // Get list of users who haven't vetted yet
    const pendingUsers = await getUsersPendingVetting(vettingMovie.id);

    return NextResponse.json({
        movie: vettingMovie,
        hasVetted: userVetting.length > 0,
        pendingUsers: pendingUsers.map(u => ({ id: u.id, name: u.name }))
    });
}

export async function POST(req: NextRequest) {
    const sessionUser = await getSessionUser();
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { seen } = await req.json();

    try {
        await submitVetting(sessionUser.id, seen);
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 400 });
    }
}
