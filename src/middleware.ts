import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/auth';

export async function middleware(request: NextRequest) {
    // Update session expiration if valid
    await updateSession(request);

    const session = request.cookies.get('session');
    const isLoginPage = request.nextUrl.pathname === '/login';

    // If trying to access protected route without session
    if (!session && !isLoginPage) {
        return NextResponse.redirect(new URL('/login', request.url));
    }

    // If trying to access login page WITH session
    if (session && isLoginPage) {
        return NextResponse.redirect(new URL('/', request.url));
    }

    return NextResponse.next();
}

export const config = {
    matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
