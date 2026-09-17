import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openStorage } from './storage.js';
import { initAuth, authService } from './auth.js';
import { handleApi } from './api.js';
import { isAdmin } from './admin.js';

// The reverse proxy preserves Host. Browser Fetch Metadata confirms that the
// page and API share an origin, even when APP_ORIGIN names a different alias.
function browserOrigin(headers, configuredOrigin) {
  const value = headers.get('origin');
  if (value === configuredOrigin) return configuredOrigin;
  if (headers.get('sec-fetch-site') !== 'same-origin' || !value) return configuredOrigin;
  try {
    const candidate = new URL(value);
    const configured = new URL(configuredOrigin);
    if (candidate.origin !== value || candidate.host !== headers.get('host')) return configuredOrigin;
    if (candidate.protocol !== configured.protocol) return configuredOrigin;
    return candidate.origin;
  } catch { return configuredOrigin; }
}

export function createVpsServer({ directory = process.env.DATA_DIR || '.vps-data', origin = process.env.APP_ORIGIN || 'http://localhost:3000', adminEmail = process.env.ADMIN_EMAIL || '' } = {}) {
  if (new URL(origin).origin !== origin) throw new Error('APP_ORIGIN deve conter apenas protocolo e domínio, sem barra final.');
  if (process.env.NODE_ENV === 'production' && !origin.startsWith('https://')) throw new Error('Produção exige APP_ORIGIN com HTTPS.');
  const storage = openStorage(directory);
  initAuth(storage.database);
  const env = { ...storage, ADMIN_EMAIL: adminEmail };
  const assets = new Map();
  for (const file of ['index.html', 'app.js', 'export.js', 'logo.svg', 'styles.css', 'admin.html', 'admin.js', 'admin.css', 'icon.svg', 'manifest.webmanifest', 'service-worker.js', 'login.html', 'login.js', 'login.css', 'vps-client.js']) {
    let body = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    if (file === 'index.html' || file === 'admin.html') body = body.replace('</body>', '<script src="/vps-client.js" defer></script></body>');
    assets.set('/' + file, body);
  }
  const publicPaths = new Set(['/login', '/login.html', '/login.js', '/login.css', '/styles.css', '/icon.svg', '/service-worker.js']);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, origin);
      const path = url.pathname;
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) if (value && !key.toLowerCase().startsWith('oai-')) headers.set(key, String(value));
      const requestOrigin = browserOrigin(headers, origin);
      const auth = authService(storage.database, requestOrigin, adminEmail);
      // Identity is derived exclusively from our session, never forwarded client headers.
      let request = new Request(requestOrigin + path + url.search, { method: req.method, headers });
      const user = auth.user(request);
      let response;
      if (!user && !publicPaths.has(path) && !path.startsWith('/auth/')) {
        response = path.startsWith('/api/') ? Response.json({ error: 'Sessão encerrada. Entre novamente na sua conta.' }, { status: 401 }) : new Response(null, { status: 303, headers: { Location: '/login' } });
      } else {
        if (!['GET', 'HEAD'].includes(req.method)) {
          if (headers.get('origin') !== requestOrigin || headers.get('sec-fetch-site') === 'cross-site') {
            response = Response.json({ error: 'Origem não autorizada.' }, { status: 403 });
          } else {
            const chunks = []; let size = 0;
            const limit = path.startsWith('/auth/') ? 4096 : 3 * 1024 * 1024;
            for await (const chunk of req) {
              size += chunk.length;
              if (size > limit) { const error = new Error('Request too large'); error.status = 413; throw error; }
              chunks.push(chunk);
            }
            request = new Request(requestOrigin + path + url.search, { method: req.method, headers, body: Buffer.concat(chunks) });
          }
        }
        if (!response) {
          if (path.startsWith('/auth/')) response = await auth.handle(request);
          else {
            if (user) { request.headers.set('oai-authenticated-user-id', user.id); request.headers.set('oai-authenticated-user-email', user.email); }
            if (path.startsWith('/api/')) response = await handleApi(request, { ...env, CURRENT_USER: user });
            else if (path.startsWith('/admin') && !isAdmin(request, env)) response = new Response('Área exclusiva do administrador.', { status: 403 });
            else if (!['GET', 'HEAD'].includes(req.method)) response = new Response(null, { status: 405 });
            else if (path === '/login' && user) response = new Response(null, { status: 303, headers: { Location: '/' } });
            else {
              const assetPath = ({ '/': '/index.html', '/admin': '/admin.html', '/login': '/login.html' })[path] || path;
              const body = assets.get(assetPath);
              const extension = assetPath.split('.').pop();
              const type = ({ html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', webmanifest: 'application/manifest+json' })[extension];
              response = new Response(req.method === 'HEAD' ? null : body ?? 'Não encontrado.', { status: body === undefined ? 404 : 200, headers: { 'Content-Type': `${type || 'text/plain'}; charset=utf-8` } });
            }
          }
        }
      }
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Referrer-Policy', 'same-origin');
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (error) {
      res.statusCode = error.status || 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: error.status === 413 ? 'Dados muito grandes.' : 'Erro no servidor.' }));
      if (!error.status) console.error(error);
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.once('close', () => storage.database.close());
  return { server, database: storage.database };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { server } = createVpsServer();
  server.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => console.log('Servidor de despesas iniciado.'));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());
}
