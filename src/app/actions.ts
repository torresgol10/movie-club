'use server';

import { searchMovies, TMDBMovie } from '@/lib/tmdb';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { login, logout } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { db } from '@/db';
import { v4 as uuidv4 } from 'uuid';

export async function logoutAction() {
    await logout();
    redirect('/login');
}

export async function searchMoviesAction(query: string): Promise<TMDBMovie[]> {
    return await searchMovies(query);
}

export async function loginAction(prevState: any, formData: FormData) {
    const username = formData.get('username') as string;
    const pin = formData.get('pin') as string;

    const user = await db.select().from(users).where(eq(users.name, username)).limit(1);

    if (user.length === 0 || user[0].pin !== pin) {
        return { error: 'Invalid username or PIN' };
    }

    // Pass valid user data to create session
    formData.append('userId', user[0].id);
    await login(formData);

    redirect('/');
}

export async function createUserAction(prevState: any, formData: FormData) {
    const username = formData.get('username') as string;
    const pin = formData.get('pin') as string;

    if (!username || !pin || pin.length !== 4) {
        return { error: 'Invalid data. PIN must be 4 digits.' };
    }

    const existing = await db.select().from(users).where(eq(users.name, username));
    if (existing.length > 0) {
        return { error: 'User already exists.' };
    }

    await db.insert(users).values({
        id: uuidv4(),
        name: username,
        pin,
    });

    return { success: true, message: 'User created successfully.' };
}


