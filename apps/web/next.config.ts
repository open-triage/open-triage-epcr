import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? "";

const nextConfig: NextConfig = {
  basePath,
  distDir: process.env.OPEN_TRIAGE_E2E_DIST_DIR ?? ".next",
  output: "export",
  trailingSlash: true,
  transpilePackages: ["@open-triage/contracts"],
  agentRules: false
};

export default nextConfig;
