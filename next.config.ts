import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // exceljs es CommonJS pesado: se carga desde node_modules en el servidor, sin empaquetarlo.
  serverExternalPackages: ["exceljs"],
  experimental: {
    // La importación de productos sube archivos de hasta 5 MB.
    serverActions: { bodySizeLimit: "6mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
