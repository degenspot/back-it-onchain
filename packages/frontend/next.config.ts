import createNextIntlPlugin from 'next-intl/plugin';
import withBundleAnalyzer from '@next/bundle-analyzer';
import type { NextConfig } from "next";

const withNextIntl = createNextIntlPlugin();

// Opt-in: `ANALYZE=true pnpm --filter frontend build` writes the treemap report.
const withAnalyzer = withBundleAnalyzer({ enabled: process.env.ANALYZE === 'true' });

const nextConfig: NextConfig = {
  experimental: {
    // Rewrites barrel-file imports to deep paths so only the icons/components
    // actually referenced are pulled into a chunk.
    optimizePackageImports: [
      'lucide-react',
      '@coinbase/onchainkit',
      'lightweight-charts',
    ],
  },
  webpack: (config) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");
    config.resolve.fallback = { fs: false, net: false, tls: false };
    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": false,
    };
    return config;
  },
  eslint: { ignoreDuringBuilds: false },
  typescript: { ignoreBuildErrors: false },
};

export default withAnalyzer(withNextIntl(nextConfig));
