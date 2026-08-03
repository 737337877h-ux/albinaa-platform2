import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
  async rewrites() {
    // وسيط تطوير: /api/* → Backend (يتجاوز CORS محليًا)
    const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:18000';
    return [{ source: '/api/:path*', destination: `${api}/:path*` }];
  },
};
export default nextConfig;
