/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:3001/api/:path*',
      },
      {
        source: '/ws',
        destination: 'http://localhost:3001/ws',
      },
    ];
  },
};

export default nextConfig;