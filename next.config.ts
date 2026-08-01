import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;

// Makes Wrangler bindings (notably D1) available to `next dev` without
// changing application code or connecting to production resources.
initOpenNextCloudflareForDev();
