/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  async rewrites() {
    // وسيط تطوير: /api/* → Backend (يتجاوز CORS محليًا)
    const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:18000';
    return [{ source: '/api/:path*', destination: `${api}/:path*` }];
  },
};
export default nextConfig;
