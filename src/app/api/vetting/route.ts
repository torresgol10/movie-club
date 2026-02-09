import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getVettingMovie, getUsersPendingVetting, submitVetting } from '@/lib/state-machine';

export async function GET(req: NextRequest) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

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
            eq(vettingResponses.userId, session.user.id)
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
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { seen } = await req.json();

    try {
        await submitVetting(session.user.id, seen);
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 400 });
    }
}
