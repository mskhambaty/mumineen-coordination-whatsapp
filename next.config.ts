import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Keep heavy/native-ish parsers out of the bundle; load them at runtime.
  serverExternalPackages: ["mammoth"],
  // Send visitors hitting the bare domain to the official Chicago relay site. Exact "/" only —
  // admin, register, and API routes are unaffected. basePath:false marks it as an external
  // redirect; 307 (temporary) so browsers don't hard-cache it.
  async redirects() {
    return [
      {
        source: "/",
        destination: "https://asharamubaraka.net/relay/chicago/",
        basePath: false,
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
