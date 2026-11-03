/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["msedge-tts"],
  experimental: {
    optimizePackageImports: ["katex"],
  },
};

export default nextConfig;
