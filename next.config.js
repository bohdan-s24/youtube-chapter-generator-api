/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  // Disable automatic static optimization for API routes
  api: {
    externalResolver: true,
  }
}

module.exports = nextConfig 