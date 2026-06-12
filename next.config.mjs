/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      // Allow uploading batches of PDFs/photos in one action call
      bodySizeLimit: '25mb',
    },
  },
};

export default nextConfig;
