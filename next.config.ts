import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Keep heavy/native-ish parsers out of the bundle; load them at runtime.
  serverExternalPackages: ["pdf-parse", "mammoth"],
};

export default nextConfig;
