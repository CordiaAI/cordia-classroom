/** @type {import('next').NextConfig} */
const isDev = process.env.NODE_ENV !== 'production';
const apiOrigin = new URL(process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000').origin;
const supabaseHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://xoolkofwihjasrvjpbrs.supabase.co').host;

// Everything the app loads is same-origin except the API and Supabase; images, files and the
// PDF worker arrive as data:/blob: URLs. 'unsafe-inline' scripts cover Turbopack's per-page
// bootstrap script (a nonce would force every page to render per request). Dev mode needs eval.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob:",
  "worker-src 'self' blob:",
  `connect-src 'self' blob: ${apiOrigin} https://${supabaseHost} wss://${supabaseHost}`,
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'report-uri /api/csp-report',
].join('; ');

module.exports = {
  reactStrictMode: true,
  async redirects() {
    return [{
      source: '/:path*',
      has: [{ type: 'host', value: 'autostudyai.online' }],
      destination: 'https://classroom.cordiaai.io/:path*',
      permanent: true,
    }];
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=()' },
        // Report-only until production reports come back clean; then rename to Content-Security-Policy.
        { key: 'Content-Security-Policy-Report-Only', value: contentSecurityPolicy },
      ],
    }];
  },
};
