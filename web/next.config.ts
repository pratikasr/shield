import path from "node:path";
import type { NextConfig } from "next";

// Optional peer imports of wallet SDKs (Base Account's x402 payments, WalletConnect logging)
// that Shield never uses. Resolving them to false keeps webpack from failing the build.
const unusedOptionalModules = [
  "@x402/core/client",
  "@x402/evm",
  "@x402/evm/exact/client",
  "@x402/evm/upto/client",
  "@x402/svm/exact/client",
  "pino-pretty",
  "lokijs",
  "encoding",
];

/**
 * Headers for every route. No page may be framed (clickjacking a wallet prompt), and the browser sends no full URL to
 * other sites. There is deliberately no script-src policy: wallet extensions and WalletConnect inject scripts and
 * frames that a strict one would break.
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // A second server (a dev build for screenshots) can use its own directory next to a production build.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // The Docker image for hosting (web/Dockerfile) sets NEXT_OUTPUT=standalone to ship only the traced server files.
  // Unset everywhere else, so `next dev`, `next start` and the tests are unchanged. The tracing root is the pnpm
  // workspace root, where the dependency store lives.
  ...(process.env.NEXT_OUTPUT === "standalone"
    ? { output: "standalone" as const, outputFileTracingRoot: path.resolve(process.cwd(), "..") }
    : {}),
  devIndicators: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // The analytics page became Stats; old links keep working.
  async redirects() {
    return [{ source: "/app/analytics", destination: "/app/stats", permanent: true }];
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      ...Object.fromEntries(unusedOptionalModules.map((m) => [m, false])),
    };
    return config;
  },
};

export default nextConfig;
