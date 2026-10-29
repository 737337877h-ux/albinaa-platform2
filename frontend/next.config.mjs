import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
  experimental: {
    // Keep the UI proxy aligned with the 250 MB APK limit enforced by the
    // mobile release endpoint. Next.js otherwise truncates uploads at 10 MB.
    middlewareClientMaxBodySize: '250mb',
  },
  async rewrites() {
    // وسيط تطوير: /api/* → Backend (يتجاوز CORS محليًا)
    const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:18000';
    return [{ source: '/api/:path*', destination: `${api}/:path*` }];
  },
};
export default nextConfig;
