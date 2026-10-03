import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev badge sits over the rail's foot; keep the frame as the prototype draws it.
  devIndicators: false,
  // The importer ships TypeScript source; Next compiles it with the app.
  transpilePackages: ["po-importer"],
};

export default nextConfig;
