'use server';

import { searchMovies, TMDBMovie } from '@/lib/tmdb';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { login, logout } from '@/lib/auth';
import { redirect } from 'next/navigation';

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

    const path = require('path');
    const sqlite = new Database(path.join(process.cwd(), 'local.db'));
    const db = drizzle(sqlite);

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

    const path = require('path');
    const sqlite = new Database(path.join(process.cwd(), 'local.db'));
    const db = drizzle(sqlite);
    const { v4: uuidv4 } = require('uuid');

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


