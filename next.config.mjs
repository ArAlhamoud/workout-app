/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        // Universal links: Apple's CDN fetches this at app install and
        // requires application/json — Vercel serves extensionless public
        // files as octet-stream without this override.
        source: '/.well-known/apple-app-site-association',
        headers: [{ key: 'Content-Type', value: 'application/json' }],
      },
    ];
  },
};

export default nextConfig;
