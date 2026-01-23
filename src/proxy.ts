import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/auth';

export async function proxy(request: NextRequest) {
    const sessionCookie = request.cookies.get('session');
    let isValidSession = false;
    let response = NextResponse.next();

    if (sessionCookie) {
        // Try to update session (validates implicitly via decrypt)
        const updateRes = await updateSession(request);
        if (updateRes) {
            isValidSession = true;
            response = updateRes;
        }
    }

    const isLoginPage = request.nextUrl.pathname === '/login';

    // If trying to access protected route without session
    if (!isValidSession && !isLoginPage) {
        return NextResponse.redirect(new URL('/login', request.url));
    }

    // If trying to access login page WITH session
    if (isValidSession && isLoginPage) {
        return NextResponse.redirect(new URL('/', request.url));
    }

    return response;
}

export const config = {
    matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
