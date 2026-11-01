/* eslint-disable @typescript-eslint/no-require-imports -- precarga de Node (CommonJS) con NODE_OPTIONS=--require */
// Solo para las pruebas E2E con varios negocios (E2E_TENANCY=multi). Chromium resuelve `<algo>.localhost` por su cuenta, pero
// Node (que usa `page.request` para las descargas y las llamadas sin navegador) no lo hace en todos los sistemas, y entonces
// `http://tienda.localhost:3100` da ENOTFOUND. Se precarga con NODE_OPTIONS=--require y manda esos nombres a 127.0.0.1,
// tanto por la forma con «callback» como por la de promesas (Playwright usa esta última).
const dns = require("node:dns");

const toLoopback = (hostname) =>
  typeof hostname === "string" && hostname.endsWith(".localhost") ? "127.0.0.1" : hostname;

const originalLookup = dns.lookup;
dns.lookup = function lookup(hostname, ...rest) {
  return originalLookup.call(this, toLoopback(hostname), ...rest);
};

const originalPromisesLookup = dns.promises.lookup;
dns.promises.lookup = function lookup(hostname, ...rest) {
  return originalPromisesLookup.call(this, toLoopback(hostname), ...rest);
};
