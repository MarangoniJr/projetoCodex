import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

function app() {
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { value: "", elements: [], addEventListener() {}, querySelector: node, querySelectorAll: () => [], classList: { toggle() {} } });
    return nodes.get(selector);
  };
  const context = createContext({ document: { querySelector: node, querySelectorAll: () => [] }, window: { addEventListener() {} }, navigator: {}, location: { protocol: "https:" }, localStorage: { getItem: () => null }, fetch: () => new Promise(() => {}), Intl, Date });
  runInContext(readFileSync("app.js", "utf8"), context);
  runInContext(`report = { consultant: 'Pessoa A', kmRate: '2' }; expenses = [
    { id: 'a', date: '2026-09-28', client: 'QQ', project: 'Suprimentos', type: 'normal', category: 'Transporte', amount: 40 },
    { id: 'b', date: '2026-09-30', client: 'QQ', project: 'Manutenção', type: 'car', km: 10, carExtra: 5 },
    { id: 'c', date: '2026-10-01', client: 'QQ', project: 'Manutenção', type: 'normal', category: 'Transporte', amount: 15 },
    { id: 'd', date: '2026-09-28', client: 'Outro', project: 'Suprimentos', type: 'normal', amount: 500 },
    { id: 'old', date: '2026-09-28', type: 'normal', amount: 1 }
  ]`, context);
  return { node, evaluate: code => runInContext(code, context) };
}

test("week spans months and client/project filters select the matching costs", () => {
  const { node, evaluate } = app();
  node("#monthFilter").value = "2026-09";
  node("#weekFilter").value = "2026-W40";
  node("#clientFilter").value = "QQ";
  node("#projectFilter").value = "Manutenção";
  assert.equal(evaluate("getFilteredExpenses().map(row => row.id).join(',')"), "b,c");
  assert.equal(evaluate("getMonthTotal(getFilteredExpenses())"), 40);
  node("#weekFilter").value = "";
  assert.equal(evaluate("getFilteredExpenses().map(row => row.id).join(',')"), "b");
  node("#clientFilter").value = "__unassigned__";
  node("#projectFilter").value = "";
  assert.equal(evaluate("getFilteredExpenses()[0].id"), "old");
});

test('stored mileage rate is independent of the report default', () => {
  const { evaluate } = app();
  assert.equal(evaluate('getExpenseTotal({type: "car", km: 100, kmRate: 1.15, carExtra: 5})'), 120);
  evaluate('report.kmRate = 9');
  assert.equal(evaluate('getExpenseTotal({type: "car", km: 100, kmRate: 1.15, carExtra: 5})'), 120);
});

test("ISO week includes dates from the previous calendar year", () => {
  const { node, evaluate } = app();
  evaluate("expenses = [{ id: 'year-end', date: '2025-12-29' }, { id: 'outside', date: '2026-01-05' }]");
  node("#weekFilter").value = "2026-W01";
  assert.equal(evaluate("getFilteredExpenses().map(row => row.id).join(',')"), "year-end");
});
