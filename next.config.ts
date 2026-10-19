import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  poweredByHeader: false,
  // Settings moved to the dedicated Pusat Admin area.
  async redirects() {
    return [
      { source: '/settings', destination: '/admin', permanent: false },
      { source: '/settings/users', destination: '/admin/akun', permanent: false },
      { source: '/admin/tahapan', destination: '/admin', permanent: false },
      { source: '/admin/cabang', destination: '/admin', permanent: false },
    ]
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'" },
        ...(process.env.NODE_ENV === 'production' ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }] : []),
      ],
    }]
  },
  turbopack: { root: process.cwd() },
};

export default nextConfig;
