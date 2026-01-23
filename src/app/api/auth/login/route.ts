import { NextResponse } from 'next/server';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { createSession } from '@/lib/auth';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { userId, pin } = body;

        if (!userId || !pin) {
            return NextResponse.json({ error: 'Missing credentials' }, { status: 400 });
        }

        const user = await db.select().from(users).where(eq(users.id, userId)).get();

        if (!user || user.pin !== pin) {
            return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
        }

        await createSession(user.id);

        return NextResponse.json({ success: true });
    } catch (error) {
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
