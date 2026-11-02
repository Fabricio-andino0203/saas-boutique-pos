import type { NextConfig } from "next";

import { securityHeaders } from "./src/config/security-headers";

const nextConfig: NextConfig = {
  /* config options here */
  // No anunciar la versión de Next en cada respuesta.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders(process.env.NODE_ENV !== "production") }];
  },
  // En desarrollo cada negocio y el panel de la plataforma se abren por su propio subdominio (`admin.localhost`, `a.localhost`).
  allowedDevOrigins: ["*.localhost"],
  cacheComponents: true,
  partialPrefetching: true,
  // exceljs es CommonJS pesado: se carga desde node_modules en el servidor, sin empaquetarlo.
  // sharp (las fotos de los productos) trae código nativo: tampoco se empaqueta.
  serverExternalPackages: ["exceljs", "sharp"],
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
