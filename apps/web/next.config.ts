import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? "";

const nextConfig: NextConfig = {
  basePath,
  output: "export",
  trailingSlash: true,
  transpilePackages: ["@open-triage/contracts"],
  agentRules: false
};

export default nextConfig;
