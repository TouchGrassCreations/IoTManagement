import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Emits dist/standalone/, a self-contained Node server for the container
  // image. The Cloudflare worker output is emitted alongside it, unchanged.
  output: "standalone",
};

export default nextConfig;
