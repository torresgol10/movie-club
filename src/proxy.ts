import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/auth';

export async function proxy(request: NextRequest) {
    const { pathname } = request.nextUrl;
    const isStaticAsset = /\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico|txt|xml|json)$/.test(pathname);
    const isPublicFile = pathname === '/manifest.webmanifest' || pathname === '/site.webmanifest' || pathname === '/robots.txt' || pathname === '/sitemap.xml';

    if (isStaticAsset || isPublicFile) {
        return NextResponse.next();
    }

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
    matcher: [
        '/((?!api|_next/static|_next/image|favicon\\.ico|favicon\\.svg|favicon-\\d+x\\d+\\.png|apple-touch-icon\\.png|web-app-manifest-\\d+x\\d+\\.png|manifest\\.webmanifest|site\\.webmanifest|robots\\.txt|sitemap\\.xml|.*\\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico)$).*)',
    ],
};
