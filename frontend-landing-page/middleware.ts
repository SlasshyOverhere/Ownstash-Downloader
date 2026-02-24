export const config = {
  matcher: '/((?!api|_next/static|_next/image|assets|favicon.ico|sw.js).*)',
};

export default function middleware(request: Request) {
  const url = new URL(request.url);

  // Skip public assets/api if not caught by matcher
  if (url.pathname.startsWith('/api') || url.pathname.includes('.')) {
    return;
  }

  const authHeader = request.headers.get('authorization');

  if (authHeader) {
    const authValue = authHeader.split(' ')[1];
    const [user, pwd] = atob(authValue).split(':');

    // @ts-ignore - process.env is available in Vercel Edge
    if (user === process.env.BASIC_AUTH_USER && pwd === process.env.BASIC_AUTH_PASSWORD) {
      return;
    }
  }

  return new Response('Access denied', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="Secure Area"',
    },
  });
}

