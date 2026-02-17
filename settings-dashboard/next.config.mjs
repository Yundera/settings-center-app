const nextConfig = {
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',
  transpilePackages: ['dashboard-core'],
  typescript: {
    ignoreBuildErrors: true,
  },
  // Production optimizations
  poweredByHeader: false,
  generateEtags: false,
  compress: true,
};

export default nextConfig;
