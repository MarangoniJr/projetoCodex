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
let clients = [];
let projects = [];
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
  status.hidden = !message;
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
  reportForm.querySelectorAll("input, select").forEach(field => { field.disabled = true; });
  try {
    if (location.protocol === "file:") throw new Error("Abra o endereço online para cadastrar despesas. Você pode baixar os dados antigos abaixo e importá-los no site.");
    const state = await api("/api/state");
    expenses = state.expenses;
    clients = state.clients || [];
    projects = state.projects || [];
    document.querySelector("#accountName").textContent = state.user?.email || "Minha conta";
    document.querySelector("#signIn").hidden = true;
    document.querySelector("#signOut").hidden = false;
    document.querySelector("#adminLink").hidden = !state.isAdmin;
    report = state.report;
    if (state.user?.firstName !== undefined && (!state.user.firstName || !state.user.lastName)) document.querySelector("#profileDialog").showModal();
    refreshChoices();
    hydrateReport();
    ready = true;
    refreshChoices();
    reportForm.querySelectorAll("input, select").forEach(field => { field.disabled = false; });
    saveButton.disabled = false;
    renderExpenses();
    showStatus("");
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
    consultant: "",
    kmRate: "1.15",
  };

  report = { ...defaults, ...report };
  document.querySelector("#kmRate").value = report.kmRate || "1.15";

  [...reportForm.elements].forEach((field) => {
    if (field.name && report[field.name] !== undefined) {
      field.value = report[field.name];
    }
  });
}

function getReportData() {
  const data = new FormData(reportForm);
  const values = { ...report };
  data.forEach((value, key) => {
    values[key] = String(value).trim();
  });
  delete values.client;
  delete values.company;
  delete values.route;
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
    .filter(matchesFilters)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function matchesFilters(expense) {
  const week = document.querySelector("#weekFilter").value;
  if (week) {
    if (!/^\d{4}-W\d{2}$/.test(week)) return false;
    const [year, number] = week.split("-W").map(Number);
    const start = new Date(Date.UTC(year, 0, 4));
    start.setUTCDate(start.getUTCDate() - (start.getUTCDay() || 7) + 1 + (number - 1) * 7);
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + 7);
    if (expense.date < start.toISOString().slice(0, 10) || expense.date >= end.toISOString().slice(0, 10)) return false;
  } else if (!expense.date.startsWith(monthFilter.value)) return false;
  return ["client", "project"].every(field => {
    const value = document.querySelector(`#${field}Filter`).value;
    return !value || (value === "__unassigned__" ? !expense[field] : expense[field] === value);
  });
}

function groupedTotals(rows) {
  const groups = new Map();
  for (const expense of rows) {
    const client = expense.client || "Sem cliente", project = expense.project || "Sem projeto";
    const key = JSON.stringify([client, project]);
    if (!groups.has(key)) groups.set(key, { client, project, total: 0 });
    groups.get(key).total += getExpenseTotal(expense);
  }
  return [...groups.values()];
}

function fillChoices(selector, values, label) {
  const element = document.querySelector(selector), previous = element.value;
  element.replaceChildren();
  if (label) {
    element.add(new Option(label, ""));
    element.add(new Option("Sem classificação", "__unassigned__"));
  }
  for (const value of [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b))) {
    element.append(new Option(value, value));
  }
  if (label) element.value = [...element.options].some(option => option.value === previous) ? previous : "";
}

function projectChoices(input, target) {
  const client = document.querySelector(input).value.trim();
  fillChoices(target, [...projects.filter(row => row.client === client).map(row => row.name), ...expenses.filter(row => row.client === client).map(row => row.project)]);
}

function catalogSelect(selector, values, placeholder) {
  const element = document.querySelector(selector), previous = element.value;
  const blank = new Option("", "");
  blank.hidden = true;
  element.replaceChildren(blank);
  for (const value of [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"))) element.add(new Option(value, value));
  element.value = [...element.options].some(option => option.value === previous) ? previous : "";
}
function refreshChoices() {
  const names = [...clients.map(row => row.name), ...expenses.map(row => row.client)];
  catalogSelect("#client", names, "Selecione um cliente");
  const selectedClient = document.querySelector("#client").value;
  catalogSelect("#project", [...projects.filter(row => row.client === selectedClient).map(row => row.name), ...expenses.filter(row => row.client === selectedClient).map(row => row.project)], "Selecione um projeto");
  document.querySelector("#addClient").disabled = !ready;
  document.querySelector("#addProject").disabled = !ready || !selectedClient;
  fillChoices("#clientOptions", names);
  fillChoices("#clientFilter", expenses.map(row => row.client), "Todos os clientes");
  const client = document.querySelector("#clientFilter").value;
  fillChoices("#projectFilter", expenses.filter(row => !client || (client === "__unassigned__" ? !row.client : row.client === client)).map(row => row.project), "Todos os projetos");
}

function getExpenseTotal(expense) {
  if (expense.type === "car") {
    return Math.round((decimal(expense.km) * decimal(expense.kmRate ?? report.kmRate ?? 1.15) + decimal(expense.carExtra)) * 100) / 100;
  }

  return decimal(expense.amount);
}

function getMonthTotal(rows) {
  return rows.reduce((sum, expense) => sum + getExpenseTotal(expense), 0);
}

function renderExpenses() {
  refreshChoices();
  const rows = getFilteredExpenses();
  document.querySelector("#filteredTotal").textContent = `${rows.length} despesas · Total: ${currency(getMonthTotal(rows))}`;
  document.querySelector("#projectTotals").innerHTML = groupedTotals(rows).map(group => `<p>${escapeHtml(group.client)} · ${escapeHtml(group.project)}: <strong>${currency(group.total)}</strong></p>`).join("");
  list.innerHTML = "";

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "panel empty-state";
    empty.textContent = "Nenhuma despesa encontrada para os filtros selecionados.";
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
    node.querySelector(".expense-context").textContent = `${expense.client || "Sem cliente"} · ${expense.project || "Sem projeto"}`;
    node.querySelector(".notes").textContent = expense.notes || "Sem observações.";

    const preview = node.querySelector(".receipt-preview");
    if (expense.receiptUrl || expense.receiptData) {
      preview.src = expense.receiptUrl || expense.receiptData;
      preview.hidden = false;
      preview.loading = "lazy";
      node.querySelector(".view-receipt-button").hidden = false;
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
const receiptDialog = document.querySelector("#receiptDialog");
let catalogKind = "client", catalogClient = "";
const catalogDialog = document.querySelector("#catalogDialog");
catalogDialog.addEventListener("cancel", event => {
  if (document.querySelector("#cancelCatalog").disabled) event.preventDefault();
});
for (const kind of ["client", "project"]) {
  document.querySelector(kind === "client" ? "#addClient" : "#addProject").addEventListener("click", () => {
    if (!ready) return;
    catalogKind = kind;
    catalogClient = document.querySelector("#client").value;
    if (kind === "project" && !catalogClient) return;
    document.querySelector("#catalogTitle").textContent = kind === "client" ? "Cadastrar cliente" : "Cadastrar projeto";
    document.querySelector("#catalogContext").textContent = kind === "project" ? `Cliente: ${catalogClient}` : "O cliente ficará disponível para as próximas despesas.";
    document.querySelector("#catalogName").value = "";
    document.querySelector("#catalogStatus").textContent = "";
    catalogDialog.showModal();
    document.querySelector("#catalogName").focus();
  });
}
document.querySelector("#cancelCatalog").addEventListener("click", () => catalogDialog.close());
document.querySelector("#catalogForm").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.target.querySelector('button[type="submit"]');
  if (button.disabled) return;
  const name = document.querySelector("#catalogName").value.trim();
  if (!name) { document.querySelector("#catalogStatus").textContent = "Informe um nome."; return; }
  button.disabled = true;
  document.querySelector("#cancelCatalog").disabled = true;
  try {
    const result = await api(catalogKind === "client" ? "/api/clients" : "/api/projects", { method: "POST", body: JSON.stringify({ name, client: catalogClient }) });
    if (catalogKind === "client") {
      clients.push(result.client);
      refreshChoices();
      document.querySelector("#client").value = result.client.name;
      document.querySelector("#project").value = "";
    } else projects.push(result.project);
    refreshChoices();
    if (catalogKind === "project") document.querySelector("#project").value = result.project.name;
    catalogDialog.close();
    showStatus("Cadastro salvo e selecionado. Você já pode usar na despesa.");
  } catch (error) { document.querySelector("#catalogStatus").textContent = error.message; }
  finally { button.disabled = false; document.querySelector("#cancelCatalog").disabled = false; }
});
const receiptFull = document.querySelector("#receiptFull");
const receiptZoom = document.querySelector("#receiptZoom");
document.querySelector("#closeReceipt").addEventListener("click", () => receiptDialog.close());
receiptDialog.addEventListener("close", () => receiptFull.removeAttribute("src"));
receiptZoom.addEventListener("click", () => {
  const actual = receiptZoom.getAttribute("aria-pressed") !== "true";
  receiptZoom.setAttribute("aria-pressed", String(actual));
  receiptZoom.textContent = actual ? "Ajustar à tela" : "Ver em tamanho real";
  receiptFull.classList.toggle("actual-size", actual);
});
receiptFull.addEventListener("load", () => { document.querySelector("#receiptViewStatus").textContent = ""; });
receiptFull.addEventListener("error", () => { document.querySelector("#receiptViewStatus").textContent = "Não foi possível carregar o comprovante. Feche e tente novamente."; });
list.addEventListener("click", event => {
  if (!event.target.matches(".view-receipt-button")) return;
  const expense = expenses.find(row => row.id === event.target.closest(".expense-card").dataset.id);
  document.querySelector("#receiptTitle").textContent = `Comprovante · ${formatDate(expense.date)}`;
  document.querySelector("#receiptViewStatus").textContent = "Carregando comprovante…";
  receiptFull.classList.remove("actual-size");
  receiptZoom.setAttribute("aria-pressed", "false");
  receiptZoom.textContent = "Ver em tamanho real";
  receiptFull.src = expense.receiptUrl || expense.receiptData;
  receiptDialog.showModal();
});

document.querySelector("#client").addEventListener("input", () => {
  document.querySelector("#project").value = "";
  refreshChoices();
});
for (const id of ["clientFilter", "projectFilter", "weekFilter"]) {
  document.querySelector(`#${id}`).addEventListener("change", () => {
    if (id === "clientFilter") document.querySelector("#projectFilter").value = "";
    renderExpenses();
  });
}
monthFilter.addEventListener("change", () => {
  document.querySelector("#weekFilter").value = "";
  renderExpenses();
});

let classifyingId = null;
const classificationDialog = document.querySelector("#classificationDialog");
document.querySelector("#editClient").addEventListener("input", () => {
  document.querySelector("#editProject").value = "";
  projectChoices("#editClient", "#editProjectOptions");
});
document.querySelector("#cancelClassification").addEventListener("click", () => classificationDialog.close());
list.addEventListener("click", event => {
  if (!event.target.matches(".classify-button")) return;
  classifyingId = event.target.closest(".expense-card").dataset.id;
  const expense = expenses.find(row => row.id === classifyingId);
  document.querySelector("#editClient").value = expense.client || "";
  document.querySelector("#editProject").value = expense.project || "";
  projectChoices("#editClient", "#editProjectOptions");
  document.querySelector("#classificationStatus").textContent = "";
  classificationDialog.showModal();
});
document.querySelector("#classificationForm").addEventListener("submit", async event => {
  event.preventDefault();
  const button = event.target.querySelector('button[type="submit"]');
  if (button.disabled) return;
  const id = classifyingId;
  button.disabled = true;
  try {
    const result = await api(`/api/expenses/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({
      client: document.querySelector("#editClient").value.trim(), project: document.querySelector("#editProject").value.trim(),
    }) });
    expenses = expenses.map(row => row.id === id ? result.expense : row);
    classificationDialog.close();
    renderExpenses();
    showStatus("Cliente e projeto atualizados.");
  } catch (error) { document.querySelector("#classificationStatus").textContent = error.message; }
  finally { button.disabled = false; }
});

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
    client: document.querySelector("#client").value.trim(), project: String(data.get("project")).trim(),
    category: type === "normal" ? data.get("category") : "",
    amount: type === "normal" ? decimal(data.get("amount")) : 0,
    from: type === "car" ? String(data.get("from")).trim() : "",
    to: type === "car" ? String(data.get("to")).trim() : "",
    km: type === "car" ? decimal(data.get("km")) : 0,
    ...(type === "car" ? { kmRate: decimal(data.get("kmRate")) } : {}),
    carExtra: type === "car" ? decimal(data.get("carExtra")) : 0,
    notes: String(data.get("notes")).trim(),
    receiptName: receipt?.name || "",
    receiptType: receipt?.type || "",
    receiptData: receipt?.data || "",
    createdAt: new Date().toISOString(),
  };

  if (!expense.client || !expense.project) { showStatus("Informe o cliente e o projeto / área.", true); return; }
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
    document.querySelector("#client").value = "";
    document.querySelector("#project").value = "";
    clearReceipt();
    pendingExpenseId = null;
    dateInput.value = localDate(new Date());
    document.querySelector("#clientFilter").value = "";
    document.querySelector("#projectFilter").value = "";
    document.querySelector("#weekFilter").value = "";
    renderExpenses();
    showStatus(receipt ? "Despesa e comprovante salvos. Selecione cliente e projeto para a próxima despesa." : "Despesa salva. Selecione cliente e projeto para a próxima despesa.");
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
    alert("Não há despesas para os filtros selecionados.");
    return;
  }

  const files = {};
  const month = rows[0].date.slice(0, 7);
  const workbooks = await buildRistiWorkbooks(rows, report, document.querySelector("#weekFilter").value || monthLabel(month));
  for (const workbook of workbooks) files[workbook.name] = workbook.bytes;

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

const profileDialog = document.querySelector('#profileDialog');
profileDialog.addEventListener('cancel', event => event.preventDefault());
document.querySelector('#profileForm').addEventListener('submit', async event => {
  event.preventDefault();
  const profileForm = event.currentTarget;
  const button = profileForm.querySelector('button');
  button.disabled = true;
  try {
    await api('/auth/profile', { method: 'POST', body: JSON.stringify(Object.fromEntries(new FormData(profileForm))) });
    profileDialog.close();
    await initialize();
  } catch (error) { document.querySelector('#profileStatus').textContent = error.message; }
  finally { button.disabled = false; }
});
