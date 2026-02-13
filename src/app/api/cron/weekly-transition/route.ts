import { NextRequest, NextResponse } from 'next/server';
import { runWeeklyTransition } from '@/lib/state-machine';

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

    try {
        const result = await runWeeklyTransition();
        return NextResponse.json({ success: true, ...result });
    } catch (error) {
        return NextResponse.json({
            success: false,
            error: (error as Error).message,
        }, { status: 500 });
    }
}
