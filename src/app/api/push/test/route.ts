import { NextResponse } from 'next/server';
import { getSessionUser } from '@/lib/auth';
import { sendPushToUser } from '@/lib/push';
import { db } from '@/db';
import { pushSubscriptions } from '@/db/schema';
import { eq } from 'drizzle-orm';

export async function GET() {
    const sessionUser = await getSessionUser();
    if (!sessionUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    // Check how many subscriptions exist for this user
    const subs = await db.select().from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, sessionUser.id))
        .all();

    if (subs.length === 0) {
        return NextResponse.json({
            success: false,
            error: 'No tienes suscripciones push. Pulsa la campana para activar notificaciones.',
            subscriptions: 0,
        });
    }

    try {
        const results = await sendPushToUser(sessionUser.id, {
            title: '🎬 Test - Sala 404',
            body: '¡Las notificaciones funcionan correctamente!',
            url: '/',
            tag: 'test',
        });

        const sent = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;
        const errors = results
            .filter(r => r.status === 'rejected')
            .map(r => (r as PromiseRejectedResult).reason?.message || String((r as PromiseRejectedResult).reason));

        return NextResponse.json({
            success: sent > 0,
            sent,
            failed,
            total: results.length,
            subscriptionsBefore: subs.length,
            errors: errors.length > 0 ? errors : undefined,
        });
    } catch (error) {
        return NextResponse.json({
            success: false,
            error: (error as Error).message,
            subscriptions: subs.length,
        }, { status: 500 });
    }
}
