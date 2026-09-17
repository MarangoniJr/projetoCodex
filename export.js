/* Native XLSX export: numeric cells, cached formulas, embedded logo and print layout. */
async function ristiLogoBytes() {
  const response = await fetch('/logo.svg');
  if (!response.ok) throw new Error('Não foi possível carregar o logo da planilha. Tente novamente.');
  const url = URL.createObjectURL(new Blob([await response.text()], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
    const canvas = document.createElement('canvas');
    canvas.width = 600; canvas.height = 532;
    canvas.getContext('2d').drawImage(img, 0, 0, 600, 532);
    return dataUrlToBytes(canvas.toDataURL('image/png'));
  } finally { URL.revokeObjectURL(url); }
}

async function buildRistiWorkbook(expenses, report, period, logoBytes) {
  const xml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  const col = index => String.fromCharCode(65 + index);
  const money = value => Math.round((Number(value) || 0) * 100) / 100;
  const rate = row => Number(row.kmRate ?? report.kmRate ?? 1.15);
  const total = row => row.type === 'car' ? money(Number(row.km) * rate(row) + Number(row.carExtra || 0)) : money(row.amount);
  const normal = expenses.filter(row => row.type === 'normal');
  const cars = expenses.filter(row => row.type === 'car');
  const grid = new Map(), merges = [], heights = new Map();
  const cell = (r, c, value = '', style = 0, formula) => {
    if (!grid.has(r)) grid.set(r, new Map());
    grid.get(r).set(c, { value, style, formula });
  };
  const merge = (r, c, endR, endC, value = '', style = 0) => {
    for (let y = r; y <= endR; y++) for (let x = c; x <= endC; x++) cell(y, x, '', style);
    cell(r, c, value, style);
    if (r !== endR || c !== endC) merges.push(`${col(c)}${r}:${col(endC)}${endR}`);
  };
  const band = (r, title) => merge(r, 0, r, 10, title, 2);
  const sum = (c, start, end) => [...grid.entries()].filter(([r]) => r >= start && r <= end).reduce((n, [, cells]) => n + (Number(cells.get(c)?.value) || 0), 0);
  const date = value => (Date.parse(`${value}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86400000;
  merge(1, 0, 5, 7, 'RELATÓRIO DE REEMBOLSO DE DESPESAS', 3);
  merge(1, 8, 5, 10);
  merge(6, 0, 6, 1, 'Nome do Consultor:', 1); merge(6, 2, 6, 7, report.consultant);
  cell(6, 8, 'Matrícula:', 1); merge(6, 9, 6, 10);
  merge(7, 0, 7, 1, 'Viagem De/Para:', 1); merge(7, 2, 7, 10, [...new Set(cars.map(e => [e.from, e.to].filter(Boolean).join(' / ')))].join('; '));
  merge(8, 0, 8, 1, 'Empresa/Local:', 1); merge(8, 2, 8, 10, [...new Set(expenses.map(e => e.client).filter(Boolean))].join('; '));
  merge(9, 0, 9, 1, 'Mês de referência:', 1); merge(9, 2, 9, 10, period);
  band(10, '');
  merge(11, 0, 11, 3, 'Recebi como adiantamento para viagem valor de R$:', 1); cell(11, 4, 0, 4);
  cell(11, 5, 'Banco:', 1); cell(11, 6); cell(11, 7, 'Agência:', 1); cell(11, 8); cell(11, 9, 'C. Corrente:', 1); cell(11, 10);
  band(12, 'APROVAÇÃO');
  merge(13, 0, 15, 3); merge(13, 4, 15, 7); merge(13, 8, 15, 10);
  merge(16, 0, 16, 3, 'Diretor/Gerente', 5); merge(16, 4, 16, 7, 'GP / Consultor', 5); merge(16, 8, 16, 10, 'Data', 5);
  band(17, 'DESPESAS REALIZADAS');
  merge(18, 0, 20, 0, 'Data', 2); merge(18, 1, 18, 3, 'Meio de transporte: Ônibus/Táxi/Metrô', 2);
  merge(19, 1, 20, 1, 'De', 2); merge(19, 2, 20, 2, 'Para', 2); merge(19, 3, 20, 3, 'Valor', 2);
  ['Outros', 'Hotel', 'Táxi', 'Refeição', 'Estacion.', 'Pedágio', 'Valor'].forEach((v, i) => merge(18, i + 4, 20, i + 4, v, 2));
  const normalStart = 21, normalEnd = normalStart + Math.max(12, normal.length) - 1;
  for (let r = normalStart; r <= normalEnd; r++) {
    for (let c = 0; c < 11; c++) cell(r, c, '', c >= 3 ? 4 : 0);
    const item = normal[r - normalStart];
    if (!item) continue;
    cell(r, 0, date(item.date), 6);
    const categoryColumn = { Transporte: 3, Outros: 4, Hotel: 5, Taxi: 6, Alimentação: 7, Refeição: 7, Estacionamento: 8, Pedágio: 9 }[item.category] ?? 4;
    cell(r, categoryColumn, money(item.amount), 4);
    cell(r, 10, total(item), 4, `SUM(D${r}:J${r})`);
  }
  const normalTotal = normalEnd + 1;
  merge(normalTotal, 0, normalTotal, 2, 'TOTAL R$', 1);
  for (let c = 3; c < 11; c++) cell(normalTotal, c, money(sum(c, normalStart, normalEnd)), 7, `SUM(${col(c)}${normalStart}:${col(c)}${normalEnd})`);
  const carBand = normalTotal + 1, carRate = carBand + 1, carHeader = carRate + 1, carStart = carHeader + 1;
  band(carBand, 'DESPESAS CARRO PRÓPRIO');
  merge(carRate, 0, carRate, 1, 'Taxa de quilometragem:', 1);
  const rates = [...new Set(cars.map(rate))];
  cell(carRate, 2, rates.length > 1 ? 'Por lançamento (Km_Detalhado)' : rates[0] ?? Number(report.kmRate || 1.15), rates.length > 1 ? 1 : 7);
  if (rates.length === 1) cell(carRate, 2, rates[0], 7, "'Km_Detalhado'!F2");
  if (rates.length > 1) heights.set(carRate, 30);
  ['Data', 'De', 'Para', 'Total Km', 'Estacionam./Pedágio', 'Valor'].forEach((v, c) => cell(carHeader, c, v, 2));
  const carEnd = carStart + Math.max(10, cars.length) - 1;
  merge(carRate, 6, carEnd + 1, 10);
  for (let r = carStart; r <= carEnd; r++) {
    for (let c = 0; c < 6; c++) cell(r, c, '', c >= 3 ? 4 : 0);
    const item = cars[r - carStart];
    if (!item) continue;
    cell(r, 0, date(item.date), 6); cell(r, 1, item.from); cell(r, 2, item.to);
    cell(r, 3, Number(item.km), 4); cell(r, 4, money(item.carExtra), 4);
    const detailRow = r - carStart + 2;
    cell(r, 5, total(item), 4, `ROUND(D${r}*'Km_Detalhado'!F${detailRow}+E${r},2)`);
  }
  const carTotal = carEnd + 1;
  merge(carTotal, 0, carTotal, 2, 'TOTAL', 1);
  for (let c = 3; c <= 5; c++) cell(carTotal, c, money(sum(c, carStart, carEnd)), 7, `SUM(${col(c)}${carStart}:${col(c)}${carEnd})`);
  band(carTotal + 1, '');
  const summary = carTotal + 2;
  merge(summary, 0, summary, 1, 'Descrição', 2); cell(summary, 2, 'Valor', 2);
  const grandTotal = money(expenses.reduce((n, item) => n + total(item), 0));
  const labels = ['Numerário Recebido(R$):', 'Total das Despesas(R$):', 'Saldo a Devolver(R$):', 'Saldo a Receber(R$):'];
  const formulas = ['E11', `K${normalTotal}+F${carTotal}`, `MAX(C${summary + 1}-C${summary + 2},0)`, `MAX(C${summary + 2}-C${summary + 1},0)`];
  labels.forEach((v, i) => { merge(summary + i + 1, 0, summary + i + 1, 1, v, 1); cell(summary + i + 1, 2, [0, grandTotal, 0, grandTotal][i], 7, formulas[i]); });
  merge(summary, 3, summary + 4, 10, 'Assinatura:', 0);
  band(summary + 5, 'APROVAÇÃO');
  merge(summary + 6, 0, summary + 8, 4); merge(summary + 6, 5, summary + 8, 8); merge(summary + 6, 9, summary + 8, 10);
  merge(summary + 9, 0, summary + 9, 4, 'Diretor/Gerente', 5); merge(summary + 9, 5, summary + 9, 8, 'Financeiro', 5); merge(summary + 9, 9, summary + 9, 10, 'Data', 5);
  merge(summary + 10, 0, summary + 10, 10, 'RUIZ INOVAÇÕES EM SOLUÇÕES DE TI EIRELLI   -   CNPJ 30.131.027/0001-84', 8);
  merge(summary + 11, 0, summary + 11, 10, 'Contato: Dpto Financeiro / Fone: 11 97669-3615 / e-mail: financeiro@risti.com.br');
  heights.set(7, 30); heights.set(8, 30);
  const cellXml = (r, c, data) => `<c r="${col(c)}${r}" s="${data.style}"${typeof data.value === 'number' || data.formula ? '' : ' t="inlineStr"'}>${data.formula ? `<f>${xml(data.formula)}</f>` : ''}${typeof data.value === 'number' || data.formula ? `<v>${data.value}</v>` : `<is><t xml:space="preserve">${xml(data.value)}</t></is>`}</c>`;
  const sheetXml = (data, mergeList, widths, drawing = false, lastRow = data.size) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${[...data].map(([r, cells]) => `<row r="${r}" ht="${drawing ? heights.get(r) || 15 : r === 1 ? 30 : 24}" customHeight="1">${[...cells].sort(([a], [b]) => a - b).map(([c, d]) => cellXml(r, c, d)).join('')}</row>`).join('')}</sheetData>${mergeList.length ? `<mergeCells count="${mergeList.length}">${mergeList.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>` : ''}<printOptions horizontalCentered="1"/><pageMargins left="0.25" right="0.25" top="0.3" bottom="0.3" header="0.1" footer="0.1"/><pageSetup paperSize="9" orientation="${drawing ? 'portrait' : 'landscape'}" fitToWidth="1" fitToHeight="${drawing && lastRow <= 75 ? 1 : 0}"/>${drawing ? '<drawing r:id="rId1"/>' : ''}</worksheet>`;
  const detail = new Map();
  const detailHead = ['Data', 'Cliente', 'Projeto / área', 'De', 'Para', 'Taxa / km', 'Total Km', 'Estacionam./Pedágio', 'Valor', 'Observações'];
  detail.set(1, new Map(detailHead.map((value, c) => [c, { value, style: 2 }])));
  cars.forEach((item, i) => detail.set(i + 2, new Map([date(item.date), item.client, item.project, item.from, item.to, rate(item), Number(item.km), money(item.carExtra), total(item), item.notes].map((value, c) => [c, { value: value ?? '', style: c === 0 ? 6 : c >= 5 && c <= 8 ? 4 : 0, ...(c === 8 ? { formula: `ROUND(F${i + 2}*G${i + 2}+H${i + 2},2)` } : {}) }]))));
  const records = new Map();
  records.set(1, new Map(['Data', 'Cliente', 'Projeto / área', 'Categoria', 'Valor', 'Observações'].map((value, c) => [c, { value, style: 2 }])));
  expenses.forEach((item, i) => records.set(i + 2, new Map([date(item.date), item.client, item.project, item.type === 'car' ? 'Carro próprio' : item.category, total(item), item.notes].map((value, c) => [c, { value: value ?? '', style: c === 0 ? 6 : c === 4 ? 4 : 0 }]))));
  const styles = `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts><fonts count="3"><font><sz val="9"/><name val="Arial"/></font><font><b/><sz val="9"/><name val="Arial"/></font><font><b/><sz val="16"/><name val="Arial"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFC0C0C0"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FF000000"/></left><right style="thin"><color rgb="FF000000"/></right><top style="thin"><color rgb="FF000000"/></top><bottom style="thin"><color rgb="FF000000"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="9">${[
    [0,0,0,'left'],[0,2,0,'left'],[0,2,0,'center'],[2,0,0,'center'],[0,0,164,'right'],[0,0,0,'center'],[0,0,165,'left'],[1,2,164,'right'],[1,0,0,'left']
  ].map(([font,fill,num,align]) => `<xf numFmtId="${num}" fontId="${font}" fillId="${fill}" borderId="1" xfId="0" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="${align}" vertical="center" wrapText="1"/></xf>`).join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const files = {
    '[Content_Types].xml': `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${[1,2,3].map(i => `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`,
    '_rels/.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Reembolso" sheetId="1" r:id="rId1"/><sheet name="Km_Detalhado" sheetId="2" r:id="rId2"/><sheet name="Lançamentos" sheetId="3" r:id="rId3"/></sheets><definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'Reembolso'!$A$1:$K$${summary + 11}</definedName></definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${[1,2,3].map(i => `<Relationship Id="rId${i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i}.xml"/>`).join('')}<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    'xl/styles.xml': styles,
    'xl/worksheets/sheet1.xml': sheetXml(grid, merges, [13,19,27,11,17,9,9,10,10,10,10], true, summary + 11),
    'xl/worksheets/sheet2.xml': sheetXml(detail, [], [13,24,24,24,24,13,13,22,15,45]),
    'xl/worksheets/sheet3.xml': sheetXml(records, [], [13,28,28,22,15,60]),
    'xl/worksheets/_rels/sheet1.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>',
    'xl/drawings/drawing1.xml': '<?xml version="1.0"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><xdr:oneCellAnchor><xdr:from><xdr:col>8</xdr:col><xdr:colOff>400000</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>40000</xdr:rowOff></xdr:from><xdr:ext cx="1000000" cy="886667"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Logo RISTI"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rId1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor></xdr:wsDr>',
    'xl/drawings/_rels/drawing1.xml.rels': '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/risti.png"/></Relationships>',
    'xl/media/risti.png': logoBytes || await ristiLogoBytes(),
  };
  return new Uint8Array(await createZip(files).arrayBuffer());
}
