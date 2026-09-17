import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { createHash } from 'node:crypto';

function exporter() {
  const context = createContext({ TextEncoder, TextDecoder, Uint8Array, DataView, Blob, atob });
  const app = readFileSync('app.js', 'utf8');
  runInContext(app.slice(app.indexOf('function createZip('), app.indexOf('window.addEventListener("beforeinstallprompt"')), context);
  runInContext(readFileSync('risti-template.js', 'utf8'), context);
  runInContext(readFileSync('export.js', 'utf8'), context);
  return context;
}
function unzip(bytes) {
  const buffer = Buffer.from(bytes), files = new Map();
  for (let p = 0; buffer.readUInt32LE(p) === 0x04034b50;) {
    const length = buffer.readUInt32LE(p + 18), nameLength = buffer.readUInt16LE(p + 26), extra = buffer.readUInt16LE(p + 28);
    const name = buffer.subarray(p + 30, p + 30 + nameLength).toString();
    const start = p + 30 + nameLength + extra;
    files.set(name, buffer.subarray(start, start + length)); p = start + length;
  }
  return files;
}
async function workbook(rows, report = { consultant: 'Consultor Exemplo', kmRate: '1.15' }) {
  const context = exporter(); context.rows = rows; context.report = report;
  return unzip(await runInContext('buildRistiWorkbook(rows, report)', context));
}
const normal = (i, category = 'Hotel') => ({ id: `normal-${i}`, type: 'normal', date: '2026-09-28', category, amount: i + 1, client: 'Cliente', project: 'Projeto' });
const car = (i, kmRate = 1.15) => ({ id: `car-${i}`, type: 'car', date: '2026-09-28', from: 'A', to: 'B', km: 100, kmRate, carExtra: 5, client: 'Cliente', project: 'Projeto' });

test('approved template retains exact logo, styles, theme, drawing and layout', async () => {
  const files = await workbook([normal(0), car(0)]);
  const fingerprints = JSON.parse(readFileSync('tests/risti-template-fingerprints.json', 'utf8'));
  for (const [name, fingerprint] of Object.entries(fingerprints)) assert.equal(createHash('sha256').update(files.get(name)).digest('hex'), fingerprint, name);
  const context = exporter();
  const template = JSON.parse(runInContext('JSON.stringify(RISTI_TEMPLATE)', context));
  for (const name of ['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']) {
    const source = Buffer.from(template[name], 'base64').toString(), output = files.get(name).toString();
    for (const tag of ['cols', 'mergeCells', 'pageMargins', 'pageSetup', 'sheetFormatPr']) {
      const pattern = new RegExp(`<${tag}\\b[^>]*?(?:/>|>[\\s\\S]*?</${tag}>)`);
      assert.equal(output.match(pattern)?.[0], source.match(pattern)?.[0], name + ':' + tag);
    }
    assert.deepEqual([...output.matchAll(/<row\b[^>]*>/g)].map(m => m[0]), [...source.matchAll(/<row\b[^>]*>/g)].map(m => m[0]));
    const styles = text => [...text.matchAll(/<c\b([^>]*?)(?:\/>|>)/g)].map(m => [m[1].match(/\br="([^"]*)"/)[1], m[1].match(/\bs="([^"]*)"/)?.[1]]);
    assert.deepEqual(styles(output), styles(source));
  }
  const book = files.get('xl/workbook.xml').toString();
  assert.match(book, /name="QQ"/); assert.match(book, /name="Km_Detalhado"/);
  assert.equal((book.match(/<sheet /g) || []).length, 2);
  assert.equal(files.has('xl/worksheets/sheet3.xml'), false);
});

test('all expense columns and mileage reconcile; source names and values are removed', async () => {
  const categories = ['Transporte', 'Outros', 'Hotel', 'Taxi', 'Alimentação', 'Refeição', 'Estacionamento', 'Pedágio'];
  const files = await workbook([...categories.map((category, i) => normal(i, category)), car(0)]);
  const main = files.get('xl/worksheets/sheet1.xml').toString();
  assert.match(main, /r="C51"[^>]*><f>SUM\(D33:K33\)\+F47<\/f><v>156<\/v>/);
  assert.match(main, /r="G33"[^>]*><f>SUM\(G21:G32\)<\/f><v>4<\/v>/);
  assert.match(main, /r="D47"[^>]*><f>SUM\(D37:D46\)<\/f><v>100<\/v>/);
  assert.match(main, /r="F47"[^>]*><f>.*?<\/f><v>120<\/v>/);
  assert.match(main, /r="C9"[^>]*><is><t[^>]*>Projeto<\/t>/);
  const text = [...files].filter(([name]) => name.endsWith('.xml')).map(([, content]) => content.toString()).join('');
  assert.doesNotMatch(text, /Paulo|Marangoni|Queiroz|Casablanca|d\.docs\.live|1781\.44|317\.44/);
  assert.equal(files.has('docProps/custom.xml'), false);
});

test('overflow, clients, projects and rates split without loss or changed row counts', async () => {
  const context = exporter();
  context.rows = [...Array.from({ length: 25 }, (_, i) => normal(i)), ...Array.from({ length: 11 }, (_, i) => car(i)), car(20, 2), { ...normal(30), client: 'Outro cliente' }, { ...normal(31), project: 'Outro projeto' }];
  const expected = context.rows.map(row => row.id).sort();
  const batches = runInContext('splitRistiReports(rows, { kmRate: "1.15" })', context);
  assert.deepEqual(Array.from(batches.flatMap(batch => batch.rows.map(row => row.id))).sort(), expected);
  for (const batch of batches) {
    assert.ok(batch.rows.filter(row => row.type === 'normal').length <= 12);
    assert.ok(batch.rows.filter(row => row.type === 'car').length <= 10);
    assert.equal(new Set(batch.rows.map(row => row.client)).size, 1);
    assert.equal(new Set(batch.rows.map(row => row.project)).size, 1);
    const file = await workbook(batch.rows, { consultant: 'Consultor', kmRate: batch.rate });
    assert.match(file.get('xl/worksheets/sheet1.xml').toString(), /r="A60"/);
  }
});

test('input text is literal text, and the direct export rejects truncation', async () => {
  const files = await workbook([{ ...normal(1), project: '=HYPERLINK("evil")' }]);
  assert.match(files.get('xl/worksheets/sheet1.xml').toString(), /t="inlineStr"><is><t xml:space="preserve">=HYPERLINK/);
  await assert.rejects(workbook(Array.from({ length: 13 }, (_, i) => normal(i))), /12 despesas/);
  await assert.rejects(workbook([car(0), car(1, 2)]), /única taxa/);
});

test('export button downloads all generated XLSX files with only filtered expenses', async () => {
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
    buildRistiWorkbooks: async rows => { exportedRows = rows; return [{ name: 'modelo-01.xlsx', bytes: new Uint8Array([80, 75]) }, { name: 'modelo-02.xlsx', bytes: new Uint8Array([80, 75]) }]; },
    capture: (blob, name) => { filename = name; context.downloaded = blob; },
  });
  runInContext(readFileSync('app.js', 'utf8'), context);
  runInContext('ready = true; api = async () => ({}); downloadBlob = capture; expenses = [{type:"normal", date:"2026-09-17", amount:10, client:"A", project:"P"}, {type:"normal", date:"2026-09-17", amount:20, client:"B", project:"P"}]', context);
  node('#monthFilter').value = '2026-09'; node('#clientFilter').value = 'A';
  await node('#exportPackage').listeners.click();
  assert.equal(exportedRows.length, 1); assert.equal(exportedRows[0].client, 'A');
  assert.equal(filename, 'reembolso-2026-09.zip');
  const zip = unzip(await context.downloaded.arrayBuffer());
  assert.ok(zip.has('modelo-01.xlsx')); assert.ok(zip.has('modelo-02.xlsx'));
});
