import { NextResponse } from 'next/server';
import { db } from '@/db';
import { users } from '@/db/schema';
import { v4 as uuidv4 } from 'uuid';

export async function GET() {
    const allUsers = await db.select().from(users).all();
    // Return only safe data (no PINs ideally, but for now we trust the client or just return names/ids)
    const safeUsers = allUsers.map(u => ({ id: u.id, name: u.name }));
    return NextResponse.json(safeUsers);
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { name, pin } = body;

        if (!name || !pin) {
            return NextResponse.json({ error: 'Name and PIN required' }, { status: 400 });
        }

        const newUser = {
            id: uuidv4(),
            name,
            pin,
        };

        await db.insert(users).values(newUser);

        return NextResponse.json(newUser);
    } catch (error) {
        return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
    }
}
