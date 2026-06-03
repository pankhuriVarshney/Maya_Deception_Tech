/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  async rewrites() {
    const serverApiUrl = 'http://backend:3001';

    return [
      {
        source: '/api/:path*',
        destination: `${serverApiUrl}/api/:path*`,
      },
      {
        source: '/health',
        destination: `${serverApiUrl}/health`,
      },
      {
        source: '/ws',
        destination: `${serverApiUrl}/ws`,
      },
    ];
  },
};

export default nextConfig;
