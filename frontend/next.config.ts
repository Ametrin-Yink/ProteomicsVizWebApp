import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: '/analysis/visualization/bioinformatics',
        destination: '/analysis/visualization/gsea',
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://127.0.0.1:8000/api/:path*',
      },
      {
        source: '/ws/:path*',
        destination: 'http://127.0.0.1:8000/ws/:path*',
      },
    ];
  },
};

export default nextConfig;
