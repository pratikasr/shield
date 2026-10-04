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

const nextConfig: NextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      ...Object.fromEntries(unusedOptionalModules.map((m) => [m, false])),
    };
    return config;
  },
};

export default nextConfig;
