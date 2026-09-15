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
let expenses = [];
let report = {};
let ready = false;
let pendingReceipt = null;
let receiptLoading = false;
let receiptGeneration = 0;
let pendingExpenseId = null;
let reportTimer;
let reportSave = Promise.resolve();
const status = document.querySelector("#connectionStatus");
const saveButton = form.querySelector('button[type="submit"]');

const today = new Date();
const localDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const currentMonth = localDate(today).slice(0, 7);
dateInput.value = localDate(today);
monthFilter.value = currentMonth;

hydrateReport();
toggleExpenseFields();
initialize();

function showStatus(message, error = false) {
  status.textContent = message;
  status.classList.toggle("error", error);
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", ...options.headers }, cache: "no-store" });
  } catch { throw new Error("Sem conexão. Seus campos e a foto continuam aqui. Conecte-se e tente novamente."); }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || "Não foi possível acessar o servidor. Atualize a página e entre na sua conta.");
  return data;
}

async function initialize() {
  saveButton.disabled = true;
  reportForm.querySelectorAll("input").forEach(field => { field.disabled = true; });
  document.querySelector("#backupLocal").hidden = !loadJson(storageKey, []).length;
  try {
    if (location.protocol === "file:") throw new Error("Abra o endereço online para cadastrar despesas. Você pode baixar os dados antigos abaixo e importá-los no site.");
    const state = await api("/api/state");
    expenses = state.expenses;
    report = state.report;
    hydrateReport();
    ready = true;
    reportForm.querySelectorAll("input").forEach(field => { field.disabled = false; });
    saveButton.disabled = false;
    renderExpenses();
    showStatus("Despesas carregadas. Os cadastros serão salvos na sua conta.");
  } catch (error) { showStatus(error.message, true); }
}

function loadJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch {
    return fallback;
  }
}

function hydrateReport() {
  const defaults = {
    reportMonth: currentMonth,
    consultant: "Paulo César Marangoni Junior",
    kmRate: "1.15",
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
    node.querySelectorAll("input, select").forEach((field) => { field.disabled = isCar; });
  });
  document.querySelectorAll(".car-fields").forEach((node) => {
    node.hidden = !isCar;
    node.querySelectorAll("input, select").forEach((field) => { if (field.id !== "kmRate") field.disabled = !isCar; });
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

function renderExpenses() {
  const rows = getFilteredExpenses();
  list.innerHTML = "";

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "panel empty-state";
    empty.textContent = "Nenhuma despesa cadastrada para este mês.";
    list.append(empty);
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
    if (expense.receiptUrl || expense.receiptData) {
      preview.src = expense.receiptUrl || expense.receiptData;
      preview.hidden = false;
      preview.loading = "lazy";
    }

    list.append(node);
  });

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
        const maxSide = 1600;
        const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const data = canvas.toDataURL("image/jpeg", 0.8);
        if (data.length > 2700000) { reject(new Error("Escolha uma foto menor para o comprovante.")); return; }
        resolve({
          name: file.name || "comprovante.jpg",
          type: "image/jpeg",
          data,
        });
      };
      image.onerror = reject;
      image.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function persistReport() {
  clearTimeout(reportTimer);
  const values = getReportData();
  report = values;
  reportSave = reportSave.catch(() => {}).then(() => api("/api/report", { method: "PUT", body: JSON.stringify(values) }));
  return reportSave;
}

reportForm.addEventListener("input", () => {
  if (!ready) return;
  report = getReportData();
  renderExpenses();
  clearTimeout(reportTimer);
  reportTimer = setTimeout(() => persistReport().then(() => showStatus("Dados do relatório salvos.")).catch(error => showStatus(error.message, true)), 600);
});

function clearReceipt() {
  receiptGeneration += 1;
  pendingReceipt = null;
  receiptLoading = false;
  document.querySelector("#receiptDraft").hidden = true;
  document.querySelector("#receiptDraft").removeAttribute("src");
  document.querySelector("#removeReceipt").hidden = true;
  document.querySelector("#receiptPhoto").value = "";
  document.querySelector("#receiptGallery").value = "";
  document.querySelector("#receiptStatus").textContent = "A foto será salva junto com esta despesa.";
}

for (const id of ["receiptPhoto", "receiptGallery"]) {
  document.querySelector(`#${id}`).addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const generation = ++receiptGeneration;
    receiptLoading = true;
    document.querySelector("#receiptStatus").textContent = "Preparando foto...";
    try {
      if (!file.type.startsWith("image/") || file.size > 25 * 1024 * 1024) throw new Error("Escolha uma imagem de até 25 MB.");
      const receipt = await resizeImage(file);
      if (generation !== receiptGeneration) return;
      pendingReceipt = receipt;
      const preview = document.querySelector("#receiptDraft");
      preview.src = receipt.data;
      preview.hidden = false;
      document.querySelector("#removeReceipt").hidden = false;
      document.querySelector("#receiptStatus").textContent = "Foto pronta. Toque em Salvar despesa para concluir.";
    } catch (error) {
      if (generation === receiptGeneration) document.querySelector("#receiptStatus").textContent = `${error.message || "Não foi possível ler esta foto. Tente uma imagem JPEG."}${pendingReceipt ? " A foto anterior foi mantida." : ""}`;
    } finally { if (generation === receiptGeneration) receiptLoading = false; }
  });
}
document.querySelector("#removeReceipt").addEventListener("click", clearReceipt);

expenseType.addEventListener("change", toggleExpenseFields);
monthFilter.addEventListener("change", renderExpenses);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!ready || saveButton.disabled) return;
  if (receiptLoading) { showStatus("Aguarde a foto terminar de carregar.", true); return; }
  const data = new FormData(form);
  const receipt = pendingReceipt;
  const type = data.get("expenseType");

  const expense = {
    id: pendingExpenseId || (pendingExpenseId = createId()),
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
  };

  saveButton.disabled = true;
  saveButton.textContent = "Salvando despesa e comprovante...";
  const inputs = [...form.querySelectorAll("input, select, textarea, button")];
  const disabledStates = inputs.map(field => field.disabled);
  inputs.forEach(field => { field.disabled = true; });
  try {
    await persistReport();
    const result = await api("/api/expenses", { method: "POST", body: JSON.stringify(expense) });
    expenses = [...expenses.filter(row => row.id !== result.expense.id), result.expense];
    monthFilter.value = result.expense.date.slice(0, 7);
    form.reset();
    clearReceipt();
    pendingExpenseId = null;
    dateInput.value = localDate(new Date());
    renderExpenses();
    showStatus(receipt ? "Despesa e comprovante salvos na sua conta." : "Despesa salva na sua conta.");
  } catch (error) { showStatus(error.message, true); }
  finally {
    inputs.forEach((field, index) => { field.disabled = disabledStates[index]; });
    saveButton.disabled = false;
    saveButton.textContent = "Salvar despesa";
    toggleExpenseFields();
  }
});

list.addEventListener("click", async (event) => {
  if (!event.target.matches(".delete-button")) return;
  const card = event.target.closest(".expense-card");
  if (!confirm("Excluir esta despesa e seu comprovante?")) return;
  event.target.disabled = true;
  try {
    await api(`/api/expenses/${encodeURIComponent(card.dataset.id)}`, { method: "DELETE" });
    expenses = expenses.filter((expense) => expense.id !== card.dataset.id);
    renderExpenses();
    showStatus("Despesa excluída.");
  } catch (error) { event.target.disabled = false; showStatus(error.message, true); }
});

clearButton.addEventListener("click", async () => {
  if (!expenses.length) return;
  const confirmed = confirm("Deseja apagar TODAS as despesas e comprovantes da sua conta, de todos os meses?");
  if (!confirmed) return;
  clearButton.disabled = true;
  try {
    for (const expense of [...expenses]) {
      await api(`/api/expenses/${encodeURIComponent(expense.id)}`, { method: "DELETE" });
      expenses = expenses.filter(row => row.id !== expense.id);
    }
    showStatus("Todas as despesas foram excluídas.");
  } catch (error) { showStatus(error.message, true); }
  finally { clearButton.disabled = false; renderExpenses(); }
});

exportButton.addEventListener("click", async () => {
  if (!ready) return;
  exportButton.disabled = true;
  try {
  report = getReportData();
  await persistReport();
  const rows = getFilteredExpenses();

  if (!rows.length) {
    alert("Não há despesas cadastradas para o mês selecionado.");
    return;
  }

  const files = {};
  const month = monthFilter.value || report.reportMonth || currentMonth;
  const spreadsheetName = `Reembolso ${monthLabel(month)}.xls`;
  files[spreadsheetName] = new TextEncoder().encode(buildSpreadsheet(rows, month));

  for (const [index, expense] of rows.entries()) {
    if (!expense.receiptUrl && !expense.receiptData) continue;
    const extension = "jpg";
    const safeDate = expense.date.replaceAll("-", "");
    const fileName = `comprovantes/${String(index + 1).padStart(2, "0")}-${safeDate}-${expense.type === "car" ? "carro" : expense.category}.${extension}`;
    if (expense.receiptUrl) {
      const response = await fetch(expense.receiptUrl, { cache: "no-store" });
      if (!response.ok || !response.headers.get("Content-Type")?.startsWith("image/")) throw new Error("Falha ao baixar um comprovante. Tente exportar novamente.");
      files[fileName] = new Uint8Array(await response.arrayBuffer());
    } else files[fileName] = dataUrlToBytes(expense.receiptData);
  }

  const zip = createZip(files);
  downloadBlob(zip, `reembolso-${month}.zip`, "application/zip");
  } catch (error) { showStatus(error.message, true); }
  finally { exportButton.disabled = false; }
});

document.querySelector("#backupLocal").addEventListener("click", () => {
  downloadBlob(JSON.stringify({ report: loadJson(reportKey, {}), expenses: loadJson(storageKey, []) }), "despesas-antigas.json", "application/json");
});
document.querySelector("#importLocal").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file || !ready) return;
  event.target.disabled = true;
  try {
    if (file.size > 40 * 1024 * 1024) throw new Error("O arquivo de importação deve ter até 40 MB.");
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.expenses)) throw new Error("Arquivo de despesas inválido.");
    let count = 0;
    for (const expense of data.expenses) {
      const result = await api("/api/expenses", { method: "POST", body: JSON.stringify(expense) });
      expenses = [...expenses.filter(row => row.id !== result.expense.id), result.expense];
      count += 1;
      showStatus(`Importando despesas: ${count} de ${data.expenses.length}...`);
    }
    showStatus(`${count} despesas importadas. Você pode repetir a importação sem duplicar os cadastros.`);
  } catch (error) { showStatus(error.message, true); }
  finally { event.target.disabled = false; event.target.value = ""; renderExpenses(); }
});

function buildSpreadsheet(rows, month) {
  const normalRows = rows.filter((expense) => expense.type === "normal");
  const carRows = rows.filter((expense) => expense.type === "car");
  const normalTotals = Object.fromEntries(normalCategories.map((category) => [category, 0]));
  const kmRate = decimal(report.kmRate);
  let carKmTotal = 0;
  let carExtraTotal = 0;

  normalRows.forEach((expense) => {
    const category = expense.category === "Alimentação" ? "Refeição" : expense.category;
    normalTotals[category] += decimal(expense.amount);
  });

  carRows.forEach((expense) => {
    carKmTotal += decimal(expense.km) * kmRate;
    carExtraTotal += decimal(expense.carExtra);
  });

  const expensesTotal = getMonthTotal(rows);

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
    <tr><td class="label" colspan="2">Nome do Consultor:</td><td colspan="10">${escapeHtml(report.consultant)}</td></tr>
    <tr><td class="label" colspan="2">Viagem De/Para:</td><td colspan="10">${escapeHtml(report.route)}</td></tr>
    <tr><td class="label" colspan="2">Empresa/Local:</td><td colspan="10">${escapeHtml(report.company)}</td></tr>
    <tr><td class="section" colspan="12">DESPESAS REALIZADAS</td></tr>
    <tr><th>Data</th><th>Meio de transporte</th><th>De</th><th>Para</th><th>Valor</th><th>Outros</th><th>Hotel</th><th>Taxi</th><th>Alimentação</th><th>Estacion.</th><th>Pedágio</th><th>Obs.</th></tr>
    ${normalRows
      .map((expense) => {
        const cells = {
          Transporte: expense.category === "Transporte" ? expense.amount : "",
          Outros: expense.category === "Outros" ? expense.amount : "",
          Hotel: expense.category === "Hotel" ? expense.amount : "",
          Taxi: expense.category === "Taxi" ? expense.amount : "",
          Refeição: ["Alimentação", "Refeição"].includes(expense.category) ? expense.amount : "",
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
    <tr><td class="label" colspan="3">Total das Despesas(R$):</td><td class="right">${expensesTotal.toFixed(2)}</td><td colspan="8">Assinatura:</td></tr>
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
    localView.setUint16(6, 0x0800, true);
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
    centralView.setUint16(8, 0x0800, true);
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
