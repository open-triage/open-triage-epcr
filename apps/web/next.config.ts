import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? "";

const nextConfig: NextConfig = {
  basePath,
  distDir: process.env.OPEN_TRIAGE_E2E_DIST_DIR ?? ".next",
  output: process.env.NODE_ENV === "development" ? undefined : "export",
  allowedDevOrigins: ["*.localhost"],
  // Native UI transport carries HTTP assets, so keep React debug data in the RSC payload.
  experimental: { reactDebugChannel: false },
  // Production uses Turbopack; the Webpack adaptation below is development-only.
  turbopack: {},
  webpack(config, { dev, isServer, webpack }) {
    if (dev && !isServer) {
      // Adapt both Next's initial connection and its HotReload ping consumer.
      // The adapter imports the original by package path, outside this replacement.
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(
        /^(?:\.\/web-socket|\.\/dev\/hot-reloader\/app\/web-socket)$/,
        (resource: { context: string; request: string }) => {
          if (/[/\\]next[/\\]dist[/\\]client(?:[/\\]dev[/\\]hot-reloader[/\\]app)?$/.test(resource.context)) {
            resource.request = fileURLToPath(new URL("./app/development-websocket.ts", import.meta.url));
          }
        },
      ));
    }
    return config;
  },
  trailingSlash: true,
  transpilePackages: ["@open-triage/contracts"],
  agentRules: false
};

export default nextConfig;
