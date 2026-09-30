/** @type {import('next').NextConfig} */
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
      ],
    }];
  },
};
