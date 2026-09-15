import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { handleApi } from "../server/api.js";
import { sqliteBinding } from "../server/local.js";
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
const expense = () => ({ id: "test-1", date: "2026-09-14", type: "normal", category: "Alimentação", amount: 42.5, notes: "Almoço", receiptName: "foto.jpg", receiptData: "data:image/jpeg;base64,/9j/2Q==" });
function call(path, method = "GET", data, user = "owner-a", headers = {}) {
  return handleApi(new Request(`https://test.example${path}`, {
    method, headers: { "Content-Type": "application/json", ...(user ? { "oai-authenticated-user-id": user } : {}), ...headers },
    ...(data ? { body: JSON.stringify(data) } : {}),
  }), env);
}
test("persists expense, receipt and report; reload returns stored values", async () => {
  assert.equal((await call("/api/report", "PUT", { reportMonth: "2026-09", consultant: "Teste", kmRate: "1.15" })).status, 200);
  assert.equal((await call("/api/expenses", "POST", expense())).status, 201);
  const state = await (await call("/api/state")).json();
  assert.equal(state.expenses[0].amount, 42.5);
  assert.equal(state.report.consultant, "Teste");
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
