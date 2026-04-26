/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // TypeScript checking is handled by `tsc --noEmit` (typecheck script).
    // The default ESLint config doesn't have @typescript-eslint/parser,
    // so we skip it during `next build` to avoid false parse errors.
    ignoreDuringBuilds: true,
  },
  env: {
    NEXT_PUBLIC_ABACUS_URL: process.env.NEXT_PUBLIC_ABACUS_URL ?? 'http://127.0.0.1:3001',
  },
};

export default nextConfig;
