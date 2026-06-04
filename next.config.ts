import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: __dirname,
  },
  // Keep heavy/native-ish parsers out of the bundle; load them at runtime.
  serverExternalPackages: ["mammoth"],
  // Land visitors hitting the bare domain on the registration form. Exact "/" only — admin,
  // register, and API routes are unaffected. 307 (temporary) so browsers don't hard-cache it.
  async redirects() {
    return [
      {
        source: "/",
        destination: "/register",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
