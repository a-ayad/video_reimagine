import path from "node:path";
import type { NextConfig } from "next";

const API_BASE = process.env.API_BASE_URL ?? "http://127.0.0.1:8090";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve("."),
  },
  // Next 16 blocks cross-origin dev resources (HMR websocket, etc.) by default.
  // We're intentionally serving over the Tailnet, so allowlist the host and IP.
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "upscale-demo",
    "upscale-demo.tail2074ee.ts.net",
    "100.115.115.118",
    // wildcard for Tailscale MagicDNS so other peers on this tailnet can hit us
    "*.ts.net",
    "*.tail2074ee.ts.net",
  ],
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${API_BASE}/api/:path*` },
      { source: "/media/:path*", destination: `${API_BASE}/media/:path*` },
      { source: "/presets/:path*", destination: `${API_BASE}/presets/:path*` },
      { source: "/health", destination: `${API_BASE}/health` },
    ];
  },
};

export default nextConfig;
