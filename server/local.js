import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { writeFile, readFile, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { handleApi } from "./api.js";

export function sqliteBinding(database) {
  return {
    async batch(statements) {
      database.exec("BEGIN");
      try { const results = []; for (const statement of statements) results.push(await statement.run()); database.exec("COMMIT"); return results; }
      catch (error) { database.exec("ROLLBACK"); throw error; }
    },
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return database.prepare(sql).get(...args) || null; },
        async all() { return { results: database.prepare(sql).all(...args) }; },
        async run() { return database.prepare(sql).run(...args); },
      };
    },
  };
}

export function localApi() {
  return {
    name: "local-expenses-api",
    apply: "serve",
    configureServer(server) {
      mkdirSync(".local-data", { recursive: true });
      const database = new DatabaseSync(".local-data/expenses.sqlite");
      database.exec("CREATE TABLE IF NOT EXISTS _local_migrations (name TEXT PRIMARY KEY)");
      for (const file of readdirSync("drizzle").filter(f => f.endsWith(".sql")).sort()) {
        if (!database.prepare("SELECT name FROM _local_migrations WHERE name = ?").get(file)) {
          database.exec("BEGIN");
          try {
            database.exec(readFileSync(`drizzle/${file}`, "utf8"));
            database.prepare("INSERT INTO _local_migrations VALUES (?)").run(file);
            database.exec("COMMIT");
          } catch (error) { database.exec("ROLLBACK"); throw error; }
        }
      }
      const receiptsRoot = resolve(".local-data");
      const env = {
        ADMIN_EMAIL: "local-owner@sites.test",
        DB: sqliteBinding(database),
        RECEIPTS: {
          async put(key, bytes) { const path = resolve(receiptsRoot, key); mkdirSync(dirname(path), { recursive: true }); await writeFile(path, bytes); },
          async get(key) { try { return { body: await readFile(resolve(receiptsRoot, key)) }; } catch (error) { if (error.code === "ENOENT") return null; throw error; } },
          async delete(key) { await rm(resolve(receiptsRoot, key), { force: true }); },
        },
      };
      server.httpServer?.once("close", () => database.close());
      server.middlewares.use(async (req, res, next) => {
        if (req.url === "/admin") { res.statusCode = 302; res.setHeader("Location", "/admin.html"); res.end(); return; }
        if (!req.url.startsWith("/api/")) return next();
        try {
          const headers = new Headers();
          for (const [name, value] of Object.entries(req.headers)) if (value) headers.set(name, String(value));
          // Development only: production never uses this identity.
          headers.set("oai-authenticated-user-id", "local-owner");
          headers.set("oai-authenticated-user-email", "local-owner@sites.test");
          const request = new Request(`http://${req.headers.host}${req.url}`, {
            method: req.method, headers,
            ...(!["GET", "HEAD"].includes(req.method) ? { body: req, duplex: "half" } : {}),
          });
          const response = await handleApi(request, env);
          res.statusCode = response.status;
          response.headers.forEach((value, name) => res.setHeader(name, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch { res.statusCode = 500; res.end("Local server error"); }
      });
    },
  };
}
