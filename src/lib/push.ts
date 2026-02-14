import webpush from 'web-push';
import { db } from '@/db';
import { pushSubscriptions, users } from '@/db/schema';
import { eq } from 'drizzle-orm';

// Configure VAPID keys from environment
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY!;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@sala404.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

export interface PushPayload {
    title: string;
    body: string;
    url?: string;
    tag?: string;
}

/**
 * Send a push notification to a specific user (all their subscriptions).
 */
export async function sendPushToUser(userId: string, payload: PushPayload) {
    const subscriptions = await db.select().from(pushSubscriptions)
        .where(eq(pushSubscriptions.userId, userId))
        .all();

    const results = await Promise.allSettled(
        subscriptions.map(sub => sendPush(sub, payload))
    );

    return results;
}

/**
 * Send a push notification to multiple users.
 */
export async function sendPushToUsers(userIds: string[], payload: PushPayload) {
    const results = await Promise.allSettled(
        userIds.map(id => sendPushToUser(id, payload))
    );
    return results;
}

/**
 * Send a push notification to ALL users.
 */
export async function sendPushToAll(payload: PushPayload) {
    const allUsers = await db.select({ id: users.id }).from(users).all();
    return sendPushToUsers(allUsers.map(u => u.id), payload);
}

/**
 * Send push to a single subscription, cleaning up expired ones.
 */
async function sendPush(
    sub: { id: string; endpoint: string; p256dh: string; auth: string },
    payload: PushPayload
) {
    try {
        await webpush.sendNotification(
            {
                endpoint: sub.endpoint,
                keys: {
                    p256dh: sub.p256dh,
                    auth: sub.auth,
                },
            },
            JSON.stringify(payload)
        );
    } catch (error: unknown) {
        // 404 or 410 means subscription is no longer valid
        const statusCode = (error as { statusCode?: number })?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
            await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
        }
        throw error;
    }
}

// ─── Notification helpers for each scenario ───────────────────────────────

/**
 * Notify all users: new movie in vetting phase.
 */
export async function notifyNewVettingMovie(movieTitle: string) {
    await sendPushToAll({
        title: '🎬 Nueva película para vetting',
        body: `"${movieTitle}" está lista para vetting. ¿La has visto?`,
        url: '/',
        tag: 'vetting-new',
    });
}

/**
 * Notify specific users who haven't vetted yet.
 */
export async function notifyPendingVetting(userIds: string[], movieTitle: string) {
    await sendPushToUsers(userIds, {
        title: '⏳ Vetting pendiente',
        body: `Aún no has respondido si has visto "${movieTitle}".`,
        url: '/',
        tag: 'vetting-reminder',
    });
}

/**
 * Notify specific users who haven't voted yet (2-day reminder).
 */
export async function notifyPendingVotes(userIds: string[], movieTitle: string) {
    await sendPushToUsers(userIds, {
        title: '🗳️ Voto pendiente',
        body: `Llevas 2 días sin votar "${movieTitle}". ¡No te olvides!`,
        url: '/',
        tag: 'vote-reminder',
    });
}

/**
 * Notify all users with the final average score when all votes are in.
 */
export async function notifyMovieCompleted(movieTitle: string, averageScore: number) {
    await sendPushToAll({
        title: '🏆 Resultado final',
        body: `"${movieTitle}" ha recibido una media de ${averageScore.toFixed(1)}/10`,
        url: '/',
        tag: 'movie-completed',
    });
}
