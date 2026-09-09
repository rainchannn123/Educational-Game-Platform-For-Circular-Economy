import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: [
    "@circular-city/contracts",
    "@circular-city/game-content",
    "@circular-city/ui",
  ],
};
export default config;
