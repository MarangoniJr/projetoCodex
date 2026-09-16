import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { handleApi } from "../server/api.js";
import { sqliteBinding } from "../server/local.js";
import { compileQuery } from "../server/admin.js";
let database, env, objects;
beforeEach(() => {
  database = new DatabaseSync(":memory:");
  for (const file of readdirSync("drizzle").filter(f => f.endsWith(".sql")).sort()) database.exec(readFileSync(`drizzle/${file}`, "utf8"));
  objects = new Map();
  env = { DB: sqliteBinding(database), RECEIPTS: {
    async put(key, bytes) { objects.set(key, bytes); },
    async get(key) { return objects.has(key) ? { body: objects.get(key) } : null; },
    async delete(key) { objects.delete(key); },
  } };
});
afterEach(() => database.close());

test("clients and projects persist separately for each authenticated person", async () => {
  const assignments = [
    { id: "supply", client: "Queiroz de Queiroz", project: "Suprimentos", date: "2026-09-14" },
    { id: "maintenance", client: "Queiroz de Queiroz", project: "Manutenção automotiva", date: "2026-09-16" },
    { id: "other-client", client: "Outro cliente", project: "Consultoria" },
  ];
  for (const fields of assignments) assert.equal((await call("/api/expenses", "POST", { ...expense(), ...fields })).status, 201);
  await call("/api/expenses", "POST", { ...expense(), ...assignments[0], project: "Projeto privado" }, "owner-b");
  const a = await (await call("/api/state")).json();
  const b = await (await call("/api/state", "GET", null, "owner-b")).json();
  assert.equal(a.expenses.length, 3);
  assert.equal(a.expenses.find(row => row.id === "supply").project, "Suprimentos");
  assert.equal(b.expenses.length, 1);
  assert.equal(b.expenses[0].project, "Projeto privado");
  assert.deepEqual(b.report, {});
});

test("a person can classify legacy expenses without changing receipt or financial data", async () => {
  await call("/api/expenses", "POST", expense());
  const before = (await (await call("/api/state")).json()).expenses[0];
  const fields = { client: "Cliente A", project: "Projeto A" };
  assert.equal((await call("/api/expenses/test-1", "PATCH", fields, "owner-b")).status, 404);
  assert.equal((await call("/api/expenses/test-1", "PATCH", fields, null)).status, 401);
  assert.equal((await call("/api/expenses/test-1", "PATCH", { ...fields, project: " " })).status, 400);
  assert.equal((await call("/api/expenses/test-1", "PATCH", fields, "owner-a", { Origin: "https://evil.example" })).status, 403);
  const result = await call("/api/expenses/test-1", "PATCH", { ...fields, amount: 999, owner: "owner-b" });
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).expense, { ...before, ...fields });
  assert.equal((await call(before.receiptUrl)).status, 200);
});

test("assignment validation rejects invalid types and oversized names", async () => {
  for (const fields of [{ client: {} }, { project: 1 }, { client: "x".repeat(201) }, { project: "x".repeat(201) }]) {
    assert.equal((await call("/api/expenses", "POST", { ...expense(), ...fields })).status, 400);
  }
});
const expense = () => ({ id: "test-1", date: "2026-09-14", type: "normal", category: "Alimentação", amount: 42.5, notes: "Almoço", receiptName: "foto.jpg", receiptData: "data:image/jpeg;base64,/9j/2Q==" });
function call(path, method = "GET", data, user = "owner-a", headers = {}) {
  return handleApi(new Request(`https://test.example${path}`, {
    method, headers: { "Content-Type": "application/json", ...(user ? { "oai-authenticated-user-id": user } : {}), ...headers },
    ...(data ? { body: JSON.stringify(data) } : {}),
  }), env);
}
test("persists expense, receipt and report; reload returns stored values", async () => {
  assert.equal((await call("/api/report", "PUT", { reportMonth: "2026-09", consultant: "Teste", kmRate: "1.15", client: "Cliente do cabeçalho" })).status, 200);
  assert.equal((await call("/api/expenses", "POST", expense())).status, 201);
  const state = await (await call("/api/state")).json();
  assert.equal(state.expenses[0].amount, 42.5);
  assert.equal(state.report.consultant, "Teste");
  assert.equal(state.report.client, "Cliente do cabeçalho");
  const receipt = await call(state.expenses[0].receiptUrl);
  assert.equal(receipt.headers.get("Content-Type"), "image/jpeg");
  assert.equal((await receipt.arrayBuffer()).byteLength, 4);
});
test("enforces identity, record ownership and same-origin writes", async () => {
  assert.equal((await call("/api/state", "GET", null, null)).status, 401);
  await call("/api/expenses", "POST", expense());
  assert.deepEqual((await (await call("/api/state", "GET", null, "owner-b")).json()).expenses, []);
  assert.equal((await call("/api/receipts/test-1", "GET", null, "owner-b")).status, 404);
  await call("/api/expenses/test-1", "DELETE", null, "owner-b");
  assert.equal(objects.size, 1);
  assert.equal((await call("/api/expenses", "POST", expense(), "owner-a", { Origin: "https://other.example" })).status, 403);
});
test("retry does not duplicate expenses or receipts; delete removes both", async () => {
  await call("/api/expenses", "POST", expense());
  await call("/api/expenses", "POST", expense());
  assert.equal(objects.size, 1);
  assert.equal((await (await call("/api/state")).json()).expenses.length, 1);
  await call("/api/expenses/test-1", "DELETE");
  assert.equal(objects.size, 0);
  assert.equal((await (await call("/api/state")).json()).expenses.length, 0);
});
test("rejects malformed amounts, dates and receipts without saving", async () => {
  for (const change of [{ amount: -1 }, { date: "2026-02-30" }, { category: "invalida" }, { receiptData: "data:image/jpeg;base64,AAAA" }]) {
    assert.equal((await call("/api/expenses", "POST", { ...expense(), ...change })).status, 400);
  }
  assert.equal(objects.size, 0);
  assert.equal((await (await call("/api/state")).json()).expenses.length, 0);
});
test("accepts car expenses and legacy receipt-less records", async () => {
  const car = { ...expense(), type: "car", km: 100, carExtra: 12, from: "A", to: "B", receiptData: "" };
  assert.equal((await call("/api/expenses", "POST", car)).status, 201);
  const saved = (await (await call("/api/state")).json()).expenses[0];
  assert.equal(saved.km, 100);
  assert.equal(saved.receiptUrl, "");
});

function adminCall(path, method = "GET", data, user = "owner-a", email = "admin@example.com") {
  env.ADMIN_EMAIL = "admin@example.com";
  return call(path, method, data, user, { "oai-authenticated-user-email": email });
}
test("admin endpoints require configured administrator and isolate every query", async () => {
  await call("/api/expenses", "POST", expense());
  await call("/api/expenses", "POST", { ...expense(), id: "other", amount: 999 }, "owner-b");
  assert.equal((await call("/api/admin/query", "POST", { sql: "SELECT * FROM expenses" })).status, 403);
  assert.equal((await adminCall("/api/admin/query", "POST", { sql: "SELECT * FROM expenses" }, "owner-b", "viewer@example.com")).status, 403);
  const result = await (await adminCall("/api/admin/query", "POST", { sql: "SELECT * FROM expenses;" })).json();
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].id, "test-1");
  assert.equal(result.editable, true);
  assert.equal((await adminCall("/api/admin/records/expenses/other")).status, 404);
});
test("SELECT grammar supports filters, aliases, JSON fields and bounded results", async () => {
  await call("/api/expenses", "POST", expense());
  const sql = "SELECT id, date AS data, json_extract(payload, '$.amount') AS valor FROM expenses WHERE amount >= 40 AND notes LIKE 'Al%' ORDER BY date DESC LIMIT 1;";
  const result = await (await adminCall("/api/admin/query", "POST", { sql })).json();
  assert.equal(result.rows[0].valor, 42.5);
  assert.equal(result.rows[0].data, "2026-09-14");
  assert.equal(result.limit, 1);
  await call("/api/expenses", "POST", { ...expense(), id: "test-2" });
  const limited = await (await adminCall("/api/admin/query", "POST", { sql: "SELECT * FROM expenses LIMIT 1" })).json();
  assert.equal(limited.rows.length, 1);
  assert.equal(limited.hasMore, true);
  assert.equal(compileQuery("SELECT notes AS id FROM expenses", "owner-a").editable, false);
  const safe = compileQuery("SELECT id FROM expenses WHERE notes = 'x''; DROP TABLE expenses;--'", "owner-a");
  assert.equal(safe.query.includes("DROP"), false);
  assert.equal(safe.values[1], "x'; DROP TABLE expenses;--");
});
test("SQL rejects writes, multiple statements, cross-owner escapes and unsupported expressions", async () => {
  const rejected = [
    "DELETE FROM expenses", "UPDATE expenses SET payload = '{}'", "DROP TABLE reports",
    "SELECT * FROM expenses; DELETE FROM reports", "SELECT * FROM expenses UNION SELECT * FROM reports",
    "SELECT * FROM sqlite_master", "SELECT * FROM main.expenses", "SELECT * FROM expenses WHERE owner = 'owner-b'",
    "SELECT * FROM expenses WHERE amount = 1 OR 1=1", "SELECT * FROM expenses LIMIT -1",
    "SELECT * FROM expenses LIMIT 201", "SELECT randomblob(10000000) FROM expenses", "PRAGMA database_list",
    "WITH x AS (SELECT * FROM expenses) SELECT * FROM x", "SELECT * FROM expenses -- comment",
    "SELECT id AS id, notes AS id FROM expenses", "SELECT * FROM expenses WHERE notes = ?",
  ];
  for (const sql of rejected) assert.throws(() => compileQuery(sql, "owner-a"), { status: 400 }, sql);
});
test("edits preserve identifiers, receipt and creation date, and update sorting date", async () => {
  await call("/api/expenses", "POST", expense());
  const original = await (await adminCall("/api/admin/records/expenses/test-1")).json();
  const result = await adminCall("/api/admin/records/expenses/test-1", "PUT", {
    version: original.version,
    data: { ...original.data, id: "hijack", date: "2026-09-20", amount: 80, receiptName: "changed.jpg", createdAt: "bad" },
  });
  assert.equal(result.status, 200);
  const saved = (await result.json()).data;
  assert.equal(saved.amount, 80);
  assert.equal(saved.id, "test-1");
  assert.equal(saved.createdAt, original.data.createdAt);
  assert.equal(saved.receiptName, original.data.receiptName);
  assert.equal((await call("/api/receipts/test-1")).status, 200);
  assert.equal(database.prepare("SELECT date FROM expenses").get().date, "2026-09-20");
  const conflict = await adminCall("/api/admin/records/expenses/test-1", "PUT", { version: original.version, data: { ...original.data, amount: 90 } });
  assert.equal(conflict.status, 409);
  assert.equal(JSON.parse(database.prepare("SELECT payload FROM expenses").get().payload).amount, 80);
});
test("invalid edits, unauthorized editors and foreign origin do not write", async () => {
  await call("/api/expenses", "POST", expense());
  const original = await (await adminCall("/api/admin/records/expenses/test-1")).json();
  const body = { version: original.version, data: { ...original.data, amount: -10 } };
  assert.equal((await adminCall("/api/admin/records/expenses/test-1", "PUT", body)).status, 400);
  assert.equal((await adminCall("/api/admin/records/expenses/test-1", "PUT", body, "owner-a", "viewer@example.com")).status, 403);
  assert.equal((await call("/api/admin/records/expenses/test-1", "PUT", body, "owner-a", { Origin: "https://evil.example", "oai-authenticated-user-email": "admin@example.com" })).status, 403);
  assert.equal(database.prepare("SELECT payload FROM expenses").get().payload, original.version);
});
test("admin can query and edit report with validation and conflict detection", async () => {
  await call("/api/report", "PUT", { reportMonth: "2026-09", consultant: "Teste", kmRate: "1.15" });
  const original = await (await adminCall("/api/admin/records/reports")).json();
  assert.equal((await adminCall("/api/admin/records/reports", "PUT", { version: original.version, data: { ...original.data, kmRate: "-1" } })).status, 400);
  assert.equal((await adminCall("/api/admin/records/reports", "PUT", { version: original.version, data: { ...original.data, consultant: "Atualizado", kmRate: "1.5" } })).status, 200);
  const result = await (await adminCall("/api/admin/query", "POST", { sql: "SELECT consultant, kmRate FROM reports;" })).json();
  assert.equal(result.rows[0].consultant, "Atualizado");
  assert.equal(result.rows[0].kmrate, "1.5");
});
