import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { submitVote, getPendingVotesForUser, getUsersPendingVoteForMovie, getWatchingMovies } from '@/lib/state-machine';
import { db } from '@/db';
import { votes } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function GET(req: NextRequest) {
    const session = await getSession();
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Get movies pending vote for this user
    const pendingMovies = await getPendingVotesForUser(session.user.id);

    // For each pending movie, get the list of pending users
    const moviesWithPendingUsers = await Promise.all(
        pendingMovies.map(async (movie) => {
            const pendingUsers = await getUsersPendingVoteForMovie(movie.id);

            const movieVotes = await db.select().from(votes).where(eq(votes.movieId, movie.id)).all();
            const averageScore = movieVotes.length > 0
                ? Number((movieVotes.reduce((sum, vote) => sum + (vote.score || 0), 0) / movieVotes.length).toFixed(1))
                : null;

            return {
                ...movie,
                averageScore,
                pendingUsers: pendingUsers.map(u => ({ id: u.id, name: u.name }))
            };
        })
    );

    const watchingMovies = await getWatchingMovies();
    const votedMovies = await Promise.all(
        watchingMovies.map(async (movie) => {
            const myVote = await db.select().from(votes)
                .where(eq(votes.movieId, movie.id))
                .all();

            const userVote = myVote.find((vote) => vote.userId === session.user.id);
            if (!userVote) return null;

            const pendingUsers = await getUsersPendingVoteForMovie(movie.id);
            const averageScore = myVote.length > 0
                ? Number((myVote.reduce((sum, vote) => sum + (vote.score || 0), 0) / myVote.length).toFixed(1))
                : null;

            return {
                ...movie,
                myScore: userVote.score,
                averageScore,
                pendingUsers: pendingUsers.map(u => ({ id: u.id, name: u.name }))
            };
        })
    );

    return NextResponse.json({
        pendingVotes: moviesWithPendingUsers,
        votedVotes: votedMovies.filter(Boolean)
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
