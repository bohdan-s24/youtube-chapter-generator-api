/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  // Disable automatic static optimization for API routes
  api: {
    externalResolver: true,
  },
  // Configure API routes
  rewrites: async () => {
    return [
      {
        source: '/api/:path*',
        destination: '/api/:path*',
      },
    ];
  }
}

module.exports = nextConfig 