import page from "./index.html?raw";
import script from "./app.js?raw";
import styles from "./styles.css?raw";
import icon from "./icon.svg?raw";
import manifest from "./manifest.webmanifest?raw";
import serviceWorker from "./service-worker.js?raw";
import { handleApi } from "./server/api.js";

const assets = {
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
    const asset = assets[path];
    if (!asset || !["GET", "HEAD"].includes(request.method)) return new Response("Não encontrado", { status: 404 });
    return new Response(request.method === "HEAD" ? null : asset[0], {
      headers: { "Content-Type": `${asset[1]}; charset=utf-8`, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" },
    });
  },
};
