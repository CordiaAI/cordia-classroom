/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== 'production';
const apiOrigin = new URL(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').origin;
const supabaseHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xoolkofwihjasrvjpbrs.supabase.co').host;

// Everything the app loads is same-origin except the API and Supabase (note covers and visuals
// are Supabase Storage images) and air drawing's MediaPipe files (jsDelivr wasm, Google-hosted
// model); other images, files and the PDF worker arrive as data:/blob: URLs. 'unsafe-inline' scripts cover Turbopack's per-page
// bootstrap script (a nonce would force every page to render per request). Dev mode needs eval.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://cdn.jsdelivr.net${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://${supabaseHost}`,
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  `connect-src 'self' blob: ${apiOrigin} https://${supabaseHost} wss://${supabaseHost} https://cdn.jsdelivr.net https://storage.googleapis.com`,
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'report-uri /api/csp-report',
].join('; ');

// Cordia Assistant (texting) is its own Next.js app with basePath /assistant, deployed as its own
// Vercel project. Classroom forwards /assistant to it, so students get one site and one login.
const assistantUrl = process.env.ASSISTANT_URL;

module.exports = {
  reactStrictMode: true,
  async rewrites() {
    // The MCP server and its OAuth discovery document (pages/api/mcp.js, oauth-protected-resource.js).
    const mcp = [
      { source: '/mcp', destination: '/api/mcp' },
      { source: '/.well-known/oauth-protected-resource', destination: '/api/oauth-protected-resource' },
      { source: '/.well-known/oauth-protected-resource/mcp', destination: '/api/oauth-protected-resource' },
    ];
    if (!assistantUrl) return mcp;
    return [
      ...mcp,
      { source: '/assistant/:path*', destination: `${assistantUrl}/assistant/:path*` },
    ];
  },
  async redirects() {
    return [{
      source: '/:path*',
      has: [{ type: 'host', value: 'autostudyai.online' }],
      destination: 'https://classroom.cordiaai.io/:path*',
      permanent: true,
    },
    // Old pages: card sets live in Library's Cards tab; the Games hub only ever held Blocks.
    { source: '/flashcards', destination: '/library?tab=cards', permanent: false },
    { source: '/games/:guideId', destination: '/play/:guideId', permanent: false }];
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(self), geolocation=(), microphone=(self)' },
      ],
    }, {
      // Classroom's own pages only: the Assistant's pages load different resources.
      source: '/((?!assistant(?:/|$)).*)',
      headers: [
        // Enforced since 2026-10-22; violations still log via /api/csp-report.
        { key: 'Content-Security-Policy', value: contentSecurityPolicy },
      ],
    }];
  },
};
