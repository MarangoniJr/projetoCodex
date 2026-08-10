const storageKey = "reembolso-viagem-expenses-v2";
const reportKey = "reembolso-viagem-report-v2";
const normalCategories = ["Transporte", "Outros", "Hotel", "Taxi", "Refeição", "Estacionamento", "Pedágio"];

const form = document.querySelector("#expenseForm");
const reportForm = document.querySelector("#reportForm");
const list = document.querySelector("#expensesList");
const template = document.querySelector("#expenseTemplate");
const dateInput = document.querySelector("#date");
const expenseType = document.querySelector("#expenseType");
const monthFilter = document.querySelector("#monthFilter");
const exportButton = document.querySelector("#exportPackage");
const clearButton = document.querySelector("#clearAll");
const installButton = document.querySelector("#installButton");

let deferredInstallPrompt = null;
let expenses = loadJson(storageKey, []);
let report = loadJson(reportKey, {});

const today = new Date();
const currentMonth = today.toISOString().slice(0, 7);
dateInput.valueAsDate = today;
monthFilter.value = currentMonth;

hydrateReport();
toggleExpenseFields();
renderExpenses();

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function hydrateReport() {
  const defaults = {
    reportMonth: currentMonth,
    consultant: "Paulo César Marangoni Junior",
    kmRate: "1.15",
    advance: "0",
  };

  report = { ...defaults, ...report };

  [...reportForm.elements].forEach((field) => {
    if (field.name && report[field.name] !== undefined) {
      field.value = report[field.name];
    }
  });
}

function getReportData() {
  const data = new FormData(reportForm);
  const values = {};
  data.forEach((value, key) => {
    values[key] = String(value).trim();
  });
  return values;
}

function currency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value || 0);
}

function decimal(value) {
  return Number(value || 0);
}

function formatDate(value) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function monthLabel(value) {
  const [year, month] = value.split("-");
  const date = new Date(Number(year), Number(month) - 1, 1);
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(date);
}

function createId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function toggleExpenseFields() {
  const isCar = expenseType.value === "car";
  document.querySelectorAll(".normal-fields").forEach((node) => {
    node.hidden = isCar;
  });
  document.querySelectorAll(".car-fields").forEach((node) => {
    node.hidden = !isCar;
  });
}

function getFilteredExpenses() {
  return expenses
    .filter((expense) => expense.date.startsWith(monthFilter.value))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function getExpenseTotal(expense) {
  if (expense.type === "car") {
    return decimal(expense.km) * decimal(report.kmRate || 0) + decimal(expense.carExtra);
  }

  return decimal(expense.amount);
}

function getMonthTotal(rows) {
  return rows.reduce((sum, expense) => sum + getExpenseTotal(expense), 0);
}

function updateSummary(rows) {
  const total = getMonthTotal(rows);
  const advance = decimal(report.advance);
  const receipts = rows.filter((expense) => expense.receiptData).length;

  document.querySelector("#monthTotal").textContent = currency(total);
  document.querySelector("#receiptCount").textContent = String(receipts);
  document.querySelector("#refundTotal").textContent = currency(Math.max(total - advance, 0));
}

function renderExpenses() {
  const rows = getFilteredExpenses();
  list.innerHTML = "";

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "panel empty-state";
    empty.textContent = "Nenhuma despesa cadastrada para este mês.";
    list.append(empty);
    updateSummary(rows);
    return;
  }

  rows.forEach((expense) => {
    const node = template.content.cloneNode(true);
    const card = node.querySelector(".expense-card");
    const title = expense.type === "car" ? `${expense.from || "Origem"} → ${expense.to || "Destino"}` : expense.category;
    const meta =
      expense.type === "car"
        ? `${formatDate(expense.date)} · ${decimal(expense.km)} km · extra ${currency(expense.carExtra)}`
        : `${formatDate(expense.date)} · ${expense.category}`;

    card.dataset.id = expense.id;
    node.querySelector(".category").textContent = expense.type === "car" ? "Carro próprio" : "Despesa realizada";
    node.querySelector("h3").textContent = title;
    node.querySelector(".expense-meta").textContent = meta;
    node.querySelector(".amount").textContent = currency(getExpenseTotal(expense));
    node.querySelector(".notes").textContent = expense.notes || "Sem observações.";

    const preview = node.querySelector(".receipt-preview");
    if (expense.receiptData) {
      preview.src = expense.receiptData;
      preview.hidden = false;
    }

    list.append(node);
  });

  updateSummary(rows);
}

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.size) {
      resolve(null);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const image = new Image();
      image.onload = () => {
        const maxSide = 1400;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve({
          name: file.name || "comprovante.jpg",
          type: "image/jpeg",
          data: canvas.toDataURL("image/jpeg", 0.78),
        });
      };
      image.onerror = reject;
      image.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

reportForm.addEventListener("input", () => {
  report = getReportData();
  saveJson(reportKey, report);
  renderExpenses();
});

expenseType.addEventListener("change", toggleExpenseFields);
monthFilter.addEventListener("change", renderExpenses);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  const receipt = await resizeImage(data.get("receiptPhoto"));
  const type = data.get("expenseType");

  expenses.push({
    id: createId(),
    type,
    date: data.get("date"),
    category: type === "normal" ? data.get("category") : "",
    amount: type === "normal" ? decimal(data.get("amount")) : 0,
    from: type === "car" ? String(data.get("from")).trim() : "",
    to: type === "car" ? String(data.get("to")).trim() : "",
    km: type === "car" ? decimal(data.get("km")) : 0,
    carExtra: type === "car" ? decimal(data.get("carExtra")) : 0,
    notes: String(data.get("notes")).trim(),
    receiptName: receipt?.name || "",
    receiptType: receipt?.type || "",
    receiptData: receipt?.data || "",
    createdAt: new Date().toISOString(),
  });

  saveJson(storageKey, expenses);
  form.reset();
  dateInput.valueAsDate = new Date();
  toggleExpenseFields();
  renderExpenses();
});

list.addEventListener("click", (event) => {
  if (!event.target.matches(".delete-button")) return;
  const card = event.target.closest(".expense-card");
  expenses = expenses.filter((expense) => expense.id !== card.dataset.id);
  saveJson(storageKey, expenses);
  renderExpenses();
});

clearButton.addEventListener("click", () => {
  if (!expenses.length) return;
  const confirmed = confirm("Deseja apagar todas as despesas salvas neste dispositivo?");
  if (!confirmed) return;
  expenses = [];
  saveJson(storageKey, expenses);
  renderExpenses();
});

exportButton.addEventListener("click", async () => {
  report = getReportData();
  saveJson(reportKey, report);
  const rows = getFilteredExpenses();

  if (!rows.length) {
    alert("Não há despesas cadastradas para o mês selecionado.");
    return;
  }

  const files = {};
  const month = monthFilter.value || report.reportMonth || currentMonth;
  const spreadsheetName = `Reembolso ${monthLabel(month)}.xls`;
  files[spreadsheetName] = new TextEncoder().encode(buildSpreadsheet(rows, month));

  rows.forEach((expense, index) => {
    if (!expense.receiptData) return;
    const extension = "jpg";
    const safeDate = expense.date.replaceAll("-", "");
    const fileName = `comprovantes/${String(index + 1).padStart(2, "0")}-${safeDate}-${expense.type === "car" ? "carro" : expense.category}.${extension}`;
    files[fileName] = dataUrlToBytes(expense.receiptData);
  });

  const zip = createZip(files);
  downloadBlob(zip, `reembolso-${month}.zip`, "application/zip");
});

function buildSpreadsheet(rows, month) {
  const normalRows = rows.filter((expense) => expense.type === "normal");
  const carRows = rows.filter((expense) => expense.type === "car");
  const normalTotals = Object.fromEntries(normalCategories.map((category) => [category, 0]));
  const kmRate = decimal(report.kmRate);
  let carKmTotal = 0;
  let carExtraTotal = 0;

  normalRows.forEach((expense) => {
    normalTotals[expense.category] += decimal(expense.amount);
  });

  carRows.forEach((expense) => {
    carKmTotal += decimal(expense.km) * kmRate;
    carExtraTotal += decimal(expense.carExtra);
  });

  const expensesTotal = getMonthTotal(rows);
  const advance = decimal(report.advance);

  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: Arial, sans-serif; }
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #222; padding: 6px; vertical-align: top; }
    .title { font-size: 18px; font-weight: bold; text-align: center; background: #d9eAD3; }
    .section { font-weight: bold; background: #d9eAD3; }
    .label { font-weight: bold; }
    .right { text-align: right; }
    .center { text-align: center; }
  </style>
</head>
<body>
  <table>
    <tr><td class="title" colspan="12">RELATÓRIO DE REEMBOLSO DE DESPESAS</td></tr>
    <tr><td colspan="12">Mês de referência: ${escapeHtml(monthLabel(month))}</td></tr>
    <tr><td class="label" colspan="2">Nome do Consultor:</td><td colspan="4">${escapeHtml(report.consultant)}</td><td class="label" colspan="2">Matrícula:</td><td>${escapeHtml(report.registration)}</td><td class="label">C. Custo:</td><td colspan="2">${escapeHtml(report.costCenter)}</td></tr>
    <tr><td class="label" colspan="2">Viagem De/Para:</td><td colspan="10">${escapeHtml(report.route)}</td></tr>
    <tr><td class="label" colspan="2">Empresa/Local:</td><td colspan="10">${escapeHtml(report.company)}</td></tr>
    <tr><td class="label" colspan="2">Motivo da Viagem:</td><td colspan="10">${escapeHtml(report.reason)}</td></tr>
    <tr><td class="label" colspan="5">Recebi como adiantamento para viagem valor de R$:</td><td class="right">${advance.toFixed(2)}</td><td class="label">Banco:</td><td>${escapeHtml(report.bank)}</td><td class="label">Agência:</td><td>${escapeHtml(report.agency)}</td><td class="label">C. Corrente:</td><td>${escapeHtml(report.account)}</td></tr>
    <tr><td class="section" colspan="12">DESPESAS REALIZADAS</td></tr>
    <tr><th>Data</th><th>Meio de transporte</th><th>De</th><th>Para</th><th>Valor</th><th>Outros</th><th>Hotel</th><th>Taxi</th><th>Refeição</th><th>Estacion.</th><th>Pedágio</th><th>Obs.</th></tr>
    ${normalRows
      .map((expense) => {
        const cells = {
          Transporte: expense.category === "Transporte" ? expense.amount : "",
          Outros: expense.category === "Outros" ? expense.amount : "",
          Hotel: expense.category === "Hotel" ? expense.amount : "",
          Taxi: expense.category === "Taxi" ? expense.amount : "",
          Refeição: expense.category === "Refeição" ? expense.amount : "",
          Estacionamento: expense.category === "Estacionamento" ? expense.amount : "",
          Pedágio: expense.category === "Pedágio" ? expense.amount : "",
        };
        return `<tr><td>${formatDate(expense.date)}</td><td>${expense.category === "Transporte" ? "Transporte" : ""}</td><td></td><td></td><td class="right">${formatMoneyCell(cells.Transporte)}</td><td class="right">${formatMoneyCell(cells.Outros)}</td><td class="right">${formatMoneyCell(cells.Hotel)}</td><td class="right">${formatMoneyCell(cells.Taxi)}</td><td class="right">${formatMoneyCell(cells.Refeição)}</td><td class="right">${formatMoneyCell(cells.Estacionamento)}</td><td class="right">${formatMoneyCell(cells.Pedágio)}</td><td>${escapeHtml(expense.notes)}</td></tr>`;
      })
      .join("")}
    <tr><td class="label" colspan="4">TOTAL R$</td><td class="right">${normalTotals.Transporte.toFixed(2)}</td><td class="right">${normalTotals.Outros.toFixed(2)}</td><td class="right">${normalTotals.Hotel.toFixed(2)}</td><td class="right">${normalTotals.Taxi.toFixed(2)}</td><td class="right">${normalTotals.Refeição.toFixed(2)}</td><td class="right">${normalTotals.Estacionamento.toFixed(2)}</td><td class="right">${normalTotals.Pedágio.toFixed(2)}</td><td></td></tr>
    <tr><td class="section" colspan="12">DESPESAS CARRO PRÓPRIO</td></tr>
    <tr><td class="label" colspan="2">Taxa de quilometragem:</td><td class="right">${kmRate.toFixed(2)}</td><td class="label">Total Km</td><td class="label">Estacionam./Pedágio</td><td class="label">Valor</td><td colspan="6"></td></tr>
    <tr><th>Data</th><th>De</th><th>Para</th><th>Total Km</th><th>Estacionam./Pedágio</th><th>Valor</th><th colspan="6">Observação</th></tr>
    ${carRows
      .map(
        (expense) =>
          `<tr><td>${formatDate(expense.date)}</td><td>${escapeHtml(expense.from)}</td><td>${escapeHtml(expense.to)}</td><td class="right">${decimal(expense.km).toFixed(2)}</td><td class="right">${decimal(expense.carExtra).toFixed(2)}</td><td class="right">${getExpenseTotal(expense).toFixed(2)}</td><td colspan="6">${escapeHtml(expense.notes)}</td></tr>`
      )
      .join("")}
    <tr><td colspan="3" class="label right">TOTAL R$</td><td class="right">${carKmTotal.toFixed(2)}</td><td class="right">${carExtraTotal.toFixed(2)}</td><td class="right">${(carKmTotal + carExtraTotal).toFixed(2)}</td><td colspan="6"></td></tr>
    <tr><td class="section" colspan="12">RESUMO</td></tr>
    <tr><td class="label" colspan="3">Numerário Recebido(R$):</td><td class="right">${advance.toFixed(2)}</td><td colspan="8"></td></tr>
    <tr><td class="label" colspan="3">Total das Despesas(R$):</td><td class="right">${expensesTotal.toFixed(2)}</td><td colspan="8">Assinatura:</td></tr>
    <tr><td class="label" colspan="3">Saldo a Devolver(R$):</td><td class="right">${Math.max(advance - expensesTotal, 0).toFixed(2)}</td><td colspan="8"></td></tr>
    <tr><td class="label" colspan="3">Saldo a Receber(R$):</td><td class="right">${Math.max(expensesTotal - advance, 0).toFixed(2)}</td><td colspan="8"></td></tr>
    <tr><td colspan="12">RUIZ INOVAÇÕES EM SOLUÇÕES DE TI EIRELLI - CNPJ 30.131.027/0001-84</td></tr>
    <tr><td colspan="12">Contato: Dpto Financeiro / Fone: 11 97669-3615 / e-mail: financeiro@risti.com.br</td></tr>
  </table>
</body>
</html>`;
}

function formatMoneyCell(value) {
  return value === "" ? "" : decimal(value).toFixed(2);
}

function dataUrlToBytes(dataUrl) {
  const base64 = dataUrl.split(",")[1];
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function downloadBlob(blob, filename, type) {
  const url = URL.createObjectURL(new Blob([blob], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function createZip(files) {
  const encoder = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  Object.entries(files).forEach(([name, content]) => {
    const nameBytes = encoder.encode(name);
    const data = content instanceof Uint8Array ? content : encoder.encode(content);
    const crc = crc32(data);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localHeader.set(nameBytes, 30);
    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    centralParts.push(centralHeader);

    offset += localHeader.length + data.length;
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, centralParts.length, true);
  endView.setUint16(10, centralParts.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
}

let crcTable = null;

function crc32(data) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
  }

  let crc = 0xffffffff;
  data.forEach((byte) => {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  });
  return (crc ^ 0xffffffff) >>> 0;
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  installButton.hidden = false;
});

installButton.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  installButton.hidden = true;
});

if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  navigator.serviceWorker.register("service-worker.js");
}
