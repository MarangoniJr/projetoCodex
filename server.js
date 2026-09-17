import page from "./index.html?raw";
import script from "./app.js?raw";
import styles from "./styles.css?raw";
import icon from "./icon.svg?raw";
import manifest from "./manifest.webmanifest?raw";
import serviceWorker from "./service-worker.js?raw";
import { handleApi } from "./server/api.js";
import { isAdmin } from "./server/admin.js";
import adminPage from "./admin.html?raw";
import adminScript from "./admin.js?raw";
import adminStyles from "./admin.css?raw";

import exportScript from "./export.js?raw";
import logo from "./logo.svg?raw";

const assets = {
  "/export.js": [exportScript, "text/javascript"],
  "/logo.svg": [logo, "image/svg+xml"],
  "/admin": [adminPage, "text/html"],
  "/admin.html": [adminPage, "text/html"],
  "/admin.js": [adminScript, "text/javascript"],
  "/admin.css": [adminStyles, "text/css"],
  "/": [page, "text/html"],
  "/index.html": [page, "text/html"],
  "/app.js": [script, "text/javascript"],
  "/styles.css": [styles, "text/css"],
  "/icon.svg": [icon, "image/svg+xml"],
  "/manifest.webmanifest": [manifest, "application/manifest+json"],
  "/service-worker.js": [serviceWorker, "text/javascript"],
};

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/api/")) return handleApi(request, env);
    if (path.startsWith("/admin") && !isAdmin(request, env)) return new Response("Área exclusiva do administrador. Entre com a conta proprietária do aplicativo.", { status: 403, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
    const asset = assets[path];
    if (!asset || !["GET", "HEAD"].includes(request.method)) return new Response("Não encontrado", { status: 404 });
    return new Response(request.method === "HEAD" ? null : asset[0], {
      headers: { "Content-Type": `${asset[1]}; charset=utf-8`, "Cache-Control": path.startsWith("/admin") ? "no-store" : "no-cache", "X-Content-Type-Options": "nosniff" },
    });
  },
};
