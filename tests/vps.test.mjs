import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVpsServer } from '../server/vps.js';
import { setPassword } from '../server/auth.js';
import { request as httpRequest } from 'node:http';

test('VPS: registration, sessions, isolation, authorization, persistence and logout', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'expenses-test-'));
  const origin = 'https://despesas.example.com';
  let instance = createVpsServer({ directory, origin, adminEmail: 'admin@example.com' });
  const start = () => new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
  const close = () => new Promise(resolve => instance.server.close(resolve));
  await start();
  const call = (path, { method = 'GET', body, cookie, headers = {} } = {}) => fetch(`http://127.0.0.1:${instance.server.address().port}${path}`, { method, redirect: 'manual', headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const password = 'Uma-senha-de-teste-123';
  try {
    assert.equal((await call('/')).status, 303);
    assert.equal((await call('/login')).status, 200);
    assert.equal((await call('/api/state', { headers: { 'oai-authenticated-user-id': 'local-owner', 'oai-authenticated-user-email': 'admin@example.com' } })).status, 401);
    assert.equal((await call('/auth/register', { method: 'POST', body: { email: 'x@example.com', password }, headers: { Origin: 'https://evil.example' } })).status, 403);
    assert.equal((await call('/auth/register', { method: 'POST', body: { email: 'admin@example.com', password } })).status, 400);
    assert.equal((await call('/auth/register', { method: 'POST', body: { email: 'x@example.com', password: 'short' } })).status, 400);
    const signup = await call('/auth/register', { method: 'POST', body: { email: 'a@example.com', password } });
    assert.equal(signup.status, 200);
    const cookie = signup.headers.get('set-cookie').split(';')[0];
    assert.match(signup.headers.get('set-cookie'), /HttpOnly; SameSite=Lax; Max-Age=43200; Secure/);
    assert.notEqual(instance.database.prepare('SELECT password FROM users WHERE email=?').get('a@example.com').password, password);
    assert.equal((await call('/auth/register', { method: 'POST', body: { email: 'a@example.com', password } })).status, 400);
    assert.equal((await call('/auth/login', { method: 'POST', body: { email: 'a@example.com', password: 'wrong' } })).status, 401);
    assert.equal((await call('/api/clients', { method: 'POST', cookie, body: { name: 'Meu cliente' } })).status, 201);
    assert.equal((await call('/api/expenses', { method: 'POST', cookie, body: { id: 'receipt-test', date: '2026-09-17', type: 'normal', category: 'Hotel', amount: 100, receiptName: 'foto.jpg', receiptData: 'data:image/jpeg;base64,/9j/2Q==' } })).status, 201);
    assert.equal((await call('/admin', { cookie, headers: { 'oai-authenticated-user-email': 'admin@example.com' } })).status, 403);
    const signupB = await call('/auth/register', { method: 'POST', body: { email: 'b@example.com', password } });
    const cookieB = signupB.headers.get('set-cookie').split(';')[0];
    assert.deepEqual((await (await call('/api/state', { cookie: cookieB })).json()).clients, []);
    assert.equal((await call('/api/receipts/receipt-test', { cookie: cookieB })).status, 404);
    assert.equal((await call('/api/clients', { method: 'POST', cookie, body: { name: 'Invalid' }, headers: { Origin: 'https://evil.example' } })).status, 403);
    await close();
    instance = createVpsServer({ directory, origin, adminEmail: 'admin@example.com' });
    await start();
    assert.deepEqual((await (await call('/api/state', { cookie })).json()).clients, [{ name: 'Meu cliente' }]);
    const receipt = await call('/api/receipts/receipt-test', { cookie });
    assert.equal(receipt.status, 200);
    assert.equal(Buffer.from(await receipt.arrayBuffer()).toString('base64'), '/9j/2Q==');
    assert.equal((await call('/auth/logout', { method: 'POST', cookie })).status, 200);
    assert.equal((await call('/api/state', { cookie })).status, 401);
    const login = await call('/auth/login', { method: 'POST', body: { email: 'a@example.com', password } });
    assert.equal(login.status, 200);
    const newCookie = login.headers.get('set-cookie').split(';')[0];
    await setPassword(instance.database, 'a@example.com', password + 'new');
    assert.equal((await call('/api/state', { cookie: newCookie })).status, 401);
    instance.database.prepare('UPDATE sessions SET expires=0').run();
    assert.equal((await call('/api/state', { cookie: cookieB })).status, 401);
    await setPassword(instance.database, 'admin@example.com', password, true);
    const admin = await call('/auth/login', { method: 'POST', body: { email: 'admin@example.com', password } });
    assert.equal((await call('/admin', { cookie: admin.headers.get('set-cookie').split(';')[0] })).status, 200);
    for (let i = 0; i < 10; i++) await call('/auth/login', { method: 'POST', body: { email: 'none@example.com', password } });
    assert.equal((await call('/auth/login', { method: 'POST', body: { email: 'none@example.com', password } })).status, 429);
  } finally { await close(); rmSync(directory, { recursive: true, force: true }); }
});

test('VPS: same-origin browser on proxy alias can register, save expenses and log in', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'expenses-alias-'));
  const instance = createVpsServer({ directory, origin: 'https://risti.com.br' });
  await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${instance.server.address().port}`;
  const headers = { Host: 'www.risti.com.br', Origin: 'https://www.risti.com.br', 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' };
  const account = { email: 'alias@example.com', password: 'Teste-seguro-1234' };
  const call = (path, body, extra = {}) => new Promise((resolve, reject) => {
    const req = httpRequest(endpoint + path, { method: 'POST', headers: { ...headers, ...extra } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
  try {
    const signup = await call('/auth/register', account);
    assert.equal(signup.status, 200);
    const cookie = signup.headers.get('set-cookie').split(';')[0];
    assert.match(signup.headers.get('set-cookie'), /Secure/);
    const expense = { id: 'alias-expense', date: '2026-09-17', type: 'normal', category: 'Hotel', amount: 100 };
    assert.equal((await call('/api/expenses', expense, { Cookie: cookie })).status, 201);
    const state = await fetch(endpoint + '/api/state', { headers: { ...headers, Cookie: cookie } });
    assert.equal((await state.json()).expenses.length, 1);
    assert.equal((await call('/auth/logout', {}, { Cookie: cookie })).status, 200);
    const login = await call('/auth/login', account);
    assert.equal(login.status, 200);
    const activeCookie = login.headers.get('set-cookie').split(';')[0];
    for (const hostile of [
      { Origin: 'https://evil.example' },
      { 'Sec-Fetch-Site': 'cross-site' },
      { 'Sec-Fetch-Site': 'same-site' },
      { 'Sec-Fetch-Site': '' },
      { Origin: 'http://www.risti.com.br' },
      { Origin: 'null' },
      { Origin: 'https://www.risti.com.br:8443' },
    ]) {
      assert.equal((await call('/auth/register', { ...account, email: 'blocked@example.com' }, hostile)).status, 403);
      assert.equal((await call('/api/expenses', expense, { Cookie: activeCookie, ...hostile })).status, 403);
    }
    assert.equal(instance.database.prepare('SELECT id FROM users WHERE email=?').get('blocked@example.com'), undefined);
  } finally {
    await new Promise(resolve => instance.server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
  }
});
