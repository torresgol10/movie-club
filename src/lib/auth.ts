import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';

const secretKey = 'secret-key-CHANGE-ME'; // In production, use process.env.JWT_SECRET
const key = new TextEncoder().encode(secretKey);

export async function encrypt(payload: any) {
    return await new SignJWT(payload)
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime('1 week')
        .sign(key);
}

export async function decrypt(input: string): Promise<any> {
    const { payload } = await jwtVerify(input, key, {
        algorithms: ['HS256'],
    });
    return payload;
}

export async function login(formData: FormData) {
    // Check against DB - Since this runs on server action, we can import db
    // But for better separation, let's keep this pure lib if possible or import db here
    // We need to verify users. For now, this function generates the session.
    // The verification logic should happen in the server action calling this.

    // Wait, let's make this function create the session cookie.
    const user = { id: formData.get('userId'), name: formData.get('username') };
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 1 week
    const session = await encrypt({ user, expires });

    (await cookies()).set('session', session, { expires, httpOnly: true });
}

export async function logout() {
    (await cookies()).set('session', '', { expires: new Date(0) });
}

export async function createSession(userId: string) {
    const user = { id: userId };
    const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 1 week
    const session = await encrypt({ user, expires });

    (await cookies()).set('session', session, { expires, httpOnly: true });
}

export async function getSession() {
    const session = (await cookies()).get('session')?.value;
    if (!session) return null;
    try {
        return await decrypt(session);
    } catch (e) {
        return null;
    }
}

export async function getSessionUser() {
    const session = await getSession();
    if (!session?.user) return null;

    const sessionUser = session.user as { id?: string; name?: string };

    if (sessionUser.id) {
        const userById = await db.select().from(users).where(eq(users.id, sessionUser.id)).get();
        if (userById) return userById;
    }

    if (sessionUser.name) {
        const userByName = await db.select().from(users).where(eq(users.name, sessionUser.name)).get();
        if (userByName) return userByName;
    }

    return null;
}

export async function updateSession(request: NextRequest) {
    const session = request.cookies.get('session')?.value;
    if (!session) return;

    try {
        // Refresh expiration
        const parsed = await decrypt(session);
        parsed.expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const res = NextResponse.next();
        res.cookies.set({
            name: 'session',
            value: await encrypt(parsed),
            httpOnly: true,
            expires: parsed.expires,
        });
        return res;
    } catch (error) {
        // Session invalid
        return null;
    }
}
