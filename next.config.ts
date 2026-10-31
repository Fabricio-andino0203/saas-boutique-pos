import type { NextConfig } from "next";

import { securityHeaders } from "./src/config/security-headers";

const nextConfig: NextConfig = {
  /* config options here */
  // No anunciar la versión de Next en cada respuesta.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders(process.env.NODE_ENV !== "production") }];
  },
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
