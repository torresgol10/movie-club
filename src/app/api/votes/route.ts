import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { submitVote, getPendingVotesForUser, getUsersPendingVoteForMovie } from '@/lib/state-machine';

export async function GET(req: NextRequest) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Get movies pending vote for this user
    const pendingMovies = await getPendingVotesForUser(session.user.id);

    // For each movie, get the list of pending users
    const moviesWithPendingUsers = await Promise.all(
        pendingMovies.map(async (movie) => {
            const pendingUsers = await getUsersPendingVoteForMovie(movie.id);
            return {
                ...movie,
                pendingUsers: pendingUsers.map(u => ({ id: u.id, name: u.name }))
            };
        })
    );

    return NextResponse.json({
        pendingVotes: moviesWithPendingUsers
    });
}

export async function POST(req: NextRequest) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { movieId, score } = await req.json();

    if (!movieId || score === undefined) {
        return NextResponse.json({ error: 'movieId and score are required' }, { status: 400 });
    }

    try {
        await submitVote(session.user.id, movieId, score);
        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: (error as Error).message }, { status: 400 });
    }
}
