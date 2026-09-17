import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

async function workbook(rows) {
  const context = createContext({ TextEncoder, Uint8Array, DataView, Blob });
  const app = readFileSync('app.js', 'utf8');
  runInContext(app.slice(app.indexOf('function createZip('), app.indexOf('window.addEventListener("beforeinstallprompt"')), context);
  runInContext(readFileSync('export.js', 'utf8'), context);
  context.rows = rows;
  context.logo = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aXuoAAAAASUVORK5CYII=', 'base64'));
  const bytes = Buffer.from(await runInContext('buildRistiWorkbook(rows, {consultant: "Consultor Exemplo", kmRate: "1.15"}, "2026-W40", logo)', context));
  const files = new Map();
  for (let p = 0; bytes.readUInt32LE(p) === 0x04034b50;) {
    const length = bytes.readUInt32LE(p + 18), nameLength = bytes.readUInt16LE(p + 26), extra = bytes.readUInt16LE(p + 28);
    const name = bytes.subarray(p + 30, p + 30 + nameLength).toString();
    const start = p + 30 + nameLength + extra;
    files.set(name, bytes.subarray(start, start + length).toString());
    p = start + length;
  }
  return files;
}

test('XLSX reference layout, embedded logo, cached formulas and per-row rates', async () => {
  const files = await workbook([
    { type: 'normal', date: '2026-09-28', category: 'Alimentação', amount: 36.9, client: 'QQ', project: 'Suporte' },
    { type: 'car', date: '2026-09-29', from: 'A', to: 'B', km: 100, kmRate: 1.15, carExtra: 5, client: 'QQ', project: 'Suporte' },
    { type: 'car', date: '2026-09-30', from: 'B', to: 'A', km: 100, kmRate: 2, carExtra: 0, client: 'QQ', project: 'Suporte', notes: '=HYPERLINK("evil")' },
  ]);
  const main = files.get('xl/worksheets/sheet1.xml');
  assert.match(main, /RELATÓRIO DE REEMBOLSO DE DESPESAS/);
  assert.match(main, /2026-W40/);
  assert.match(main, /r="C51"[^>]*><f>K33\+F47<\/f><v>356.9<\/v>/);
  assert.match(main, /r="D47"[^>]*><f>SUM\(D37:D46\)<\/f><v>200<\/v>/);
  assert.match(main, /Por lançamento/);
  assert.match(main, /mergeCell ref="A1:H5"/);
  assert.ok(files.has('xl/media/risti.png'));
  assert.match(files.get('xl/workbook.xml'), /Km_Detalhado/);
  assert.match(files.get('xl/worksheets/sheet2.xml'), /<f>ROUND\(F2\*G2\+H2,2\)<\/f><v>120<\/v>/);
  assert.match(files.get('xl/worksheets/sheet3.xml'), /t="inlineStr"><is><t xml:space="preserve">=HYPERLINK/);
});

test('XLSX expands the reference layout without truncating expenses', async () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ type: 'normal', date: '2026-09-28', category: 'Hotel', amount: i + 1, client: 'Cliente', project: 'Projeto' }));
  const files = await workbook(rows);
  const main = files.get('xl/worksheets/sheet1.xml');
  assert.match(main, /r="K41"[^>]*><f>SUM\(K21:K40\)<\/f><v>210<\/v>/);
  assert.match(main, /r="C59"[^>]*><f>K41\+F55<\/f><v>210<\/v>/);
});

test('export button downloads an XLSX package with only filtered expenses', async () => {
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { value: '', elements: [], listeners: {}, addEventListener(event, fn) { this.listeners[event] = fn; }, querySelector: node, querySelectorAll: () => [], classList: { toggle() {} } });
    return nodes.get(selector);
  };
  let exportedRows, filename;
  const context = createContext({
    document: { querySelector: node, querySelectorAll: () => [] }, window: { addEventListener() {} }, navigator: {}, location: { protocol: 'https:' }, localStorage: { getItem: () => null },
    fetch: () => new Promise(() => {}), Intl, Date, TextEncoder, Uint8Array, DataView, Blob, clearTimeout() {},
    FormData: class { forEach(callback) { callback('2026-09', 'reportMonth'); callback('Consultor', 'consultant'); } },
    buildRistiWorkbook: async rows => { exportedRows = rows; return new Uint8Array([80, 75]); },
    capture: (blob, name) => { filename = name; context.downloaded = blob; },
  });
  runInContext(readFileSync('app.js', 'utf8'), context);
  runInContext('ready = true; api = async () => ({}); downloadBlob = capture; expenses = [{type:"normal", date:"2026-09-17", amount:10, client:"A", project:"P"}, {type:"normal", date:"2026-09-17", amount:20, client:"B", project:"P"}]', context);
  node('#monthFilter').value = '2026-09'; node('#clientFilter').value = 'A';
  await node('#exportPackage').listeners.click();
  assert.equal(exportedRows.length, 1);
  assert.equal(exportedRows[0].client, 'A');
  assert.equal(filename, 'reembolso-2026-09.zip');
  assert.match(Buffer.from(await context.downloaded.arrayBuffer()).toString(), /\.xlsx/);
});
