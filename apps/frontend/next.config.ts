import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a self-contained `.next/standalone` server (only the traced
  // node_modules the app actually needs), which is what the production
  // Docker image copies instead of the full node_modules tree.
  output: "standalone",
};

export default nextConfig;
