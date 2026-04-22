import type { NextConfig } from 'next';
import { resolve } from 'node:path';

const config: NextConfig = {
  serverExternalPackages: ['bun', 'bun:sql'],
  turbopack: {
    resolveAlias: {
      '@researcher': resolve(__dirname, '..', 'src'),
    },
  },
};

export default config;
