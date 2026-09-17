/* Fill the approved workbook package without reconstructing its visual design. */
function splitRistiReports(rows, report) {
  const groups = new Map();
  for (const expense of rows) {
    const key = JSON.stringify([expense.client || '', expense.project || '']);
    if (!groups.has(key)) groups.set(key, { client: expense.client || '', project: expense.project || '', normal: [], cars: new Map() });
    const group = groups.get(key);
    if (expense.type === 'car') {
      const rate = Number(expense.kmRate ?? report.kmRate ?? 1.15);
      if (!Number.isFinite(rate) || rate < 0) throw new Error('Uma despesa tem taxa de quilometragem inválida. Corrija antes de exportar.');
      if (!group.cars.has(rate)) group.cars.set(rate, []);
      group.cars.get(rate).push(expense);
    } else group.normal.push(expense);
  }
  const batches = [];
  for (const group of groups.values()) {
    const rateGroups = group.cars.size ? [...group.cars] : [[Number(report.kmRate ?? 1.15), []]];
    rateGroups.forEach(([rate, cars], groupIndex) => {
      const normal = groupIndex === 0 ? group.normal : [];
      const pages = Math.max(Math.ceil(normal.length / 12), Math.ceil(cars.length / 10), 1);
      for (let page = 0; page < pages; page++) batches.push({
        client: group.client, project: group.project, rate,
        rows: [...normal.slice(page * 12, page * 12 + 12), ...cars.slice(page * 10, page * 10 + 10)],
      });
    });
  }
  return batches;
}

async function buildRistiWorkbooks(rows, report, period) {
  const batches = splitRistiReports(rows, report);
  const safe = text => String(text || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/[. ]+$/g, '').slice(0, 60);
  const outputs = [];
  for (const [index, batch] of batches.entries()) {
    const suffix = batches.length > 1 ? ` - ${String(index + 1).padStart(2, '0')} - ${safe(batch.client) || 'Sem cliente'}` : '';
    outputs.push({ name: `Reembolso ${safe(period)}${suffix}.xlsx`, bytes: await buildRistiWorkbook(batch.rows, { ...report, kmRate: batch.rate }) });
  }
  return outputs;
}

async function buildRistiWorkbook(expenses, report) {
  const normal = expenses.filter(row => row.type !== 'car');
  const cars = expenses.filter(row => row.type === 'car');
  if (normal.length > 12 || cars.length > 10) throw new Error('O modelo comporta 12 despesas e 10 trajetos por relatório. Use a exportação completa para dividir os arquivos.');
  const rates = [...new Set(cars.map(row => Number(row.kmRate ?? report.kmRate ?? 1.15)))];
  if (rates.length > 1) throw new Error('Cada relatório do modelo deve usar uma única taxa de quilometragem.');
  const rate = rates[0] ?? Number(report.kmRate ?? 1.15);
  const round = value => Math.round((Number(value) || 0) * 100) / 100;
  const date = value => (Date.parse(`${value}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000;
  const escape = value => String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const decoder = new TextDecoder();
  const files = {};
  for (const [name, base64] of Object.entries(RISTI_TEMPLATE)) {
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
    files[name] = name.endsWith('.png') ? bytes : decoder.decode(bytes);
  }
  const main = new Map(), detail = new Map();
  const put = (target, cell, value, formula) => target.set(cell, { value, formula });
  const set = (cell, value, formula) => put(main, cell, value, formula);
  set('C6', report.consultant || '');
  const routes = [...new Set(cars.map(row => [row.from, row.to].filter(Boolean).join(' / ')).filter(Boolean))];
  const places = new Set(cars.flatMap(row => [row.from, row.to]).filter(Boolean));
  set('C7', places.size > 2 ? 'Conforme discriminação abaixo' : routes[0] || '');
  set('C8', [...new Set(expenses.map(row => row.client).filter(Boolean))].join('; '));
  set('C9', [...new Set(expenses.map(row => row.project).filter(Boolean))].join('; '));
  set('E11', 0);
  set('C35', rate);
  const totals = Object.fromEntries('DEFGHIJK'.split('').map(column => [column, 0]));
  normal.forEach((expense, index) => {
    const row = 21 + index;
    const column = { Transporte: 'D', Outros: 'E', Hotel: 'F', Taxi: 'G', Alimentação: 'H', Refeição: 'H', Estacionamento: 'I', Pedágio: 'J' }[expense.category] || 'E';
    const amount = round(expense.amount);
    set(`A${row}`, date(expense.date));
    set(`${column}${row}`, amount);
    totals[column] += amount;
  });
  for (const column of Object.keys(totals)) {
    if (column === 'D' && !totals[column]) set('D33', '', 'IF(SUM(D21:D32)=0,"",SUM(D21:D32))');
    else set(`${column}33`, round(totals[column]), `SUM(${column}21:${column}32)`);
  }
  let km = 0, extra = 0, carTotal = 0;
  const detailSlots = [1, 2, 3, 4, 9, 10, 11, 12, 13, 14];
  cars.forEach((expense, index) => {
    const row = 37 + index;
    const distance = Number(expense.km || 0), toll = round(expense.carExtra);
    const value = round(distance * rate + toll);
    km += distance; extra += toll; carTotal += value;
    set(`A${row}`, date(expense.date)); set(`B${row}`, expense.from || ''); set(`C${row}`, expense.to || '');
    set(`D${row}`, distance); set(`E${row}`, toll);
    // The approved form intentionally leaves F37:F42 blank.
    if (row >= 43) set(`F${row}`, value, `ROUND(D${row}*$C$35+E${row},2)`);
    const detailRow = detailSlots[index];
    put(detail, `A${detailRow}`, date(expense.date)); put(detail, `B${detailRow}`, expense.from || '');
    put(detail, `C${detailRow}`, expense.to || ''); put(detail, `D${detailRow}`, distance);
  });
  for (let index = Math.max(cars.length, 6); index < 10; index++) set(`F${37 + index}`, 0, `ROUND(D${37 + index}*$C$35+E${37 + index},2)`);
  set('D47', round(km), 'SUM(D37:D46)'); set('E47', round(extra), 'SUM(E37:E46)');
  set('F47', round(carTotal), `SUM(${Array.from({ length: 10 }, (_, i) => `ROUND(D${37 + i}*$C$35+E${37 + i},2)`).join(',')})`);
  const total = round(Object.values(totals).reduce((sum, value) => sum + value, 0) + carTotal);
  set('C50', '', 'IF(E11=0,"",E11)'); set('C51', total, 'SUM(D33:K33)+F47');
  set('C52', 0, 'IF(C50-C51>0,C50-C51,0)'); set('C53', total, 'IF(C50-C51<0,C51-C50,0)');
  for (const [start, end, subtotal] of [[1, 4, 5], [9, 14, 15], [19, 26, 27]]) {
    const distance = [...detail].filter(([ref]) => /^D\d+$/.test(ref) && Number(ref.slice(1)) >= start && Number(ref.slice(1)) <= end).reduce((sum, [, cell]) => sum + cell.value, 0);
    put(detail, `D${subtotal}`, round(distance), `SUM(D${start}:D${end})`);
    put(detail, `E${subtotal}`, round(distance * rate), `ROUND(D${subtotal}*'QQ'!$C$35,2)`);
  }
  const fill = (sheet, values) => {
    const pending = new Set(values.keys());
    const result = sheet.replace(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g, raw => {
      const ref = raw.match(/\br="([A-Z]+\d+)"/)?.[1];
      const item = values.get(ref);
      if (!item) return raw;
      pending.delete(ref);
      const attributes = raw.match(/^<c\b([^>]*?)(?:\/?>)/)[1].replace(/\/$/, '').replace(/\s+(?:t|cm|vm)="[^"]*"/g, '');
      if (typeof item.value === 'number') {
        if (!Number.isFinite(item.value)) throw new Error('Uma despesa contém data ou valor inválido.');
        return `<c${attributes}>${item.formula ? `<f>${escape(item.formula)}</f>` : ''}<v>${item.value}</v></c>`;
      }
      if (item.formula) return `<c${attributes} t="str"><f>${escape(item.formula)}</f><v>${escape(item.value)}</v></c>`;
      return `<c${attributes} t="inlineStr"><is><t xml:space="preserve">${escape(item.value)}</t></is></c>`;
    });
    if (pending.size) throw new Error(`O modelo está incompleto: ${[...pending].join(', ')}.`);
    return result;
  };
  files['xl/worksheets/sheet1.xml'] = fill(files['xl/worksheets/sheet1.xml'], main);
  files['xl/worksheets/sheet2.xml'] = fill(files['xl/worksheets/sheet2.xml'], detail);
  return new Uint8Array(await createZip(files).arrayBuffer());
}
