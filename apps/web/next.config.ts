import type { NextConfig } from "next";

// The browser only talks to this origin: /api/* is proxied to the Express API, so the httpOnly
// session cookie stays first-party and no CORS is needed.
const apiUrl = process.env.API_URL ?? "http://localhost:4000";

const config: NextConfig = {
  transpilePackages: ["@crm/shared"],
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }];
  },
};

export default config;
