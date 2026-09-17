import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
const digest = value => createHash('sha256').update(value).digest('hex');
const lifetime = 12 * 60 * 60 * 1000;

export function initAuth(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS login_attempts (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires INTEGER NOT NULL);`);
}
export async function setPassword(db, email, password, create = false) {
  email = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error('E-mail inválido.');
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw new Error('Use uma senha de 12 a 256 caracteres.');
  const salt = randomBytes(16).toString('hex');
  const hash = `${salt}:${(await derive(password, salt, 64)).toString('hex')}`;
  const user = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (create && user) throw new Error('Conta já cadastrada. Use password para alterar a senha.');
  if (!create && !user) throw new Error('Conta não encontrada.');
  if (create) db.prepare('INSERT INTO users VALUES (?,?,?)').run(randomUUID(), email, hash);
  else {
    db.prepare('UPDATE users SET password=? WHERE id=?').run(hash, user.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
  }
}
export function authService(db, origin, adminEmail = '') {
  const secure = new URL(origin).protocol === 'https:';
  const name = secure ? '__Host-reembolso' : 'reembolso';
  const cookie = (value, age) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
  const token = request => request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1) || '';
  const response = (data, status = 200, headers = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
  return {
    user(request) {
      return db.prepare('SELECT users.id, users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?').get(digest(token(request)), Date.now());
    },
    async handle(request) {
      const path = new URL(request.url).pathname;
      if (request.method !== 'POST') return response({ error: 'Método não permitido.' }, 405);
      if (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site') return response({ error: 'Origem não autorizada.' }, 403);
      if (path === '/auth/logout') {
        db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token(request)));
        return response({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
      }
      if (!['/auth/login', '/auth/register'].includes(path)) return response({ error: 'Não encontrado.' }, 404);
      const now = Date.now();
      db.prepare('DELETE FROM sessions WHERE expires<=?').run(now);
      db.prepare('DELETE FROM login_attempts WHERE expires<=?').run(now);
      // Global ceiling also bounds concurrent expensive password derivations.
      const key = 'global';
      db.prepare('INSERT INTO login_attempts VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(key, now + 60000);
      if (db.prepare('SELECT count FROM login_attempts WHERE key=?').get(key).count > 30) return response({ error: 'Muitas tentativas. Aguarde um minuto.' }, 429, { 'Retry-After': '60' });
      let input;
      try { input = await request.json(); } catch { return response({ error: 'Dados inválidos.' }, 400); }
      if (!input || typeof input.email !== 'string' || input.email.length > 254 || typeof input.password !== 'string' || input.password.length > 256) return response({ error: 'E-mail ou senha inválidos.' }, 400);
      const email = input.email.trim().toLowerCase();
      if (path === '/auth/register') {
        if (email === adminEmail.trim().toLowerCase()) return response({ error: 'Este e-mail está reservado. Solicite acesso ao administrador.' }, 400);
        try { await setPassword(db, email, input.password, true); }
        catch (error) { return response({ error: error.code?.startsWith('ERR_SQLITE') ? 'Não foi possível cadastrar esta conta.' : error.message }, 400); }
      }
      const accountKey = digest(email);
      db.prepare('INSERT INTO login_attempts VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1').run(accountKey, now + 15 * 60000);
      if (db.prepare('SELECT count FROM login_attempts WHERE key=?').get(accountKey).count > 10) return response({ error: 'Muitas tentativas. Aguarde 15 minutos.' }, 429, { 'Retry-After': '900' });
      const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
      const [salt, expected] = (user?.password || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
      const actual = await derive(input.password, salt, 64);
      if (!timingSafeEqual(actual, Buffer.from(expected, 'hex')) || !user) return response({ error: 'E-mail ou senha incorretos.' }, 401);
      db.prepare('DELETE FROM login_attempts WHERE key=?').run(accountKey);
      db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token(request)));
      const value = randomBytes(32).toString('hex');
      db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(value), user.id, now + lifetime);
      return response({ ok: true }, 200, { 'Set-Cookie': cookie(value, lifetime / 1000) });
    },
  };
}
