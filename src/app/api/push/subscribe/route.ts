import { NextRequest, NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { db } from '@/db';
import { pushSubscriptions } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

// GET: return VAPID public key
export async function GET() {
    return NextResponse.json({
        publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '',
    });
}

// POST: save or update a push subscription
export async function POST(req: NextRequest) {
    const sessionUser = await getSessionUser();
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { subscription } = await req.json();

    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
        return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
    }

    // Check if this endpoint already exists for this user
    const existing = await db.select().from(pushSubscriptions)
        .where(and(
            eq(pushSubscriptions.userId, sessionUser.id),
            eq(pushSubscriptions.endpoint, subscription.endpoint)
        ))
        .get();

    if (existing) {
        // Update keys if they changed
        await db.update(pushSubscriptions).set({
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth,
        }).where(eq(pushSubscriptions.id, existing.id));
    } else {
        await db.insert(pushSubscriptions).values({
            id: crypto.randomUUID(),
            userId: sessionUser.id,
            endpoint: subscription.endpoint,
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth,
        });
    }

    return NextResponse.json({ success: true });
}

// DELETE: remove a push subscription
export async function DELETE(req: NextRequest) {
    const sessionUser = await getSessionUser();
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { endpoint } = await req.json();

    if (!endpoint) {
        return NextResponse.json({ error: 'endpoint required' }, { status: 400 });
    }

    await db.delete(pushSubscriptions)
        .where(and(
            eq(pushSubscriptions.userId, sessionUser.id),
            eq(pushSubscriptions.endpoint, endpoint)
        ));

    return NextResponse.json({ success: true });
}
