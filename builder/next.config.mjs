/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@booklith/core", "@booklith/reader"],
  serverExternalPackages: ["msedge-tts"],
  webpack: (config) => {
    // workspace packages use ESM ".js" specifiers that map to ".ts" sources
    config.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return config;
  },
};

export default nextConfig;
