import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { sqliteBinding } from './local.js';

export function openStorage(directory) {
  const root = resolve(directory);
  mkdirSync(root, { recursive: true });
  const database = new DatabaseSync(resolve(root, 'expenses.sqlite'));
  database.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS _local_migrations (name TEXT PRIMARY KEY)');
  for (const file of readdirSync(new URL('../drizzle/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) {
    if (database.prepare('SELECT name FROM _local_migrations WHERE name=?').get(file)) continue;
    database.exec('BEGIN');
    try {
      database.exec(readFileSync(new URL(`../drizzle/${file}`, import.meta.url), 'utf8'));
      database.prepare('INSERT INTO _local_migrations VALUES (?)').run(file);
      database.exec('COMMIT');
    } catch (error) { database.exec('ROLLBACK'); database.close(); throw error; }
  }
  const safePath = key => {
    const path = resolve(root, key);
    if (!path.startsWith(root + sep)) throw new Error('Invalid storage path');
    return path;
  };
  return { database, DB: sqliteBinding(database), RECEIPTS: {
    async put(key, bytes) { const path = safePath(key); mkdirSync(dirname(path), { recursive: true }); await writeFile(path, bytes); },
    async get(key) { try { return { body: await readFile(safePath(key)) }; } catch (error) { if (error.code === 'ENOENT') return null; throw error; } },
    async delete(key) { await rm(safePath(key), { force: true }); },
  } };
}
