const storageKey = "reembolso-viagem-expenses";
const statuses = ["Pendente", "Enviado", "Aprovado", "Rejeitado"];

const form = document.querySelector("#expenseForm");
const list = document.querySelector("#expensesList");
const template = document.querySelector("#expenseTemplate");
const dateInput = document.querySelector("#date");
const tripFilter = document.querySelector("#tripFilter");
const statusFilter = document.querySelector("#statusFilter");
const exportButton = document.querySelector("#exportCsv");
const clearButton = document.querySelector("#clearAll");
const installButton = document.querySelector("#installButton");

let deferredInstallPrompt = null;
let expenses = loadExpenses();

dateInput.valueAsDate = new Date();

function loadExpenses() {
  try {
    return JSON.parse(localStorage.getItem(storageKey)) || [];
  } catch {
    return [];
  }
}

function saveExpenses() {
  localStorage.setItem(storageKey, JSON.stringify(expenses));
}

function currency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function formatDate(value) {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function createId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getFilteredExpenses() {
  const tripTerm = tripFilter.value.trim().toLowerCase();
  const selectedStatus = statusFilter.value;

  return expenses
    .filter((expense) => {
      const matchesTrip = expense.trip.toLowerCase().includes(tripTerm);
      const matchesStatus = selectedStatus === "Todos" || expense.status === selectedStatus;
      return matchesTrip && matchesStatus;
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

function updateSummary() {
  const pending = expenses
    .filter((expense) => expense.status !== "Aprovado")
    .reduce((sum, expense) => sum + expense.amount, 0);
  const approved = expenses
    .filter((expense) => expense.status === "Aprovado")
    .reduce((sum, expense) => sum + expense.amount, 0);

  document.querySelector("#pendingTotal").textContent = currency(pending);
  document.querySelector("#approvedTotal").textContent = currency(approved);
  document.querySelector("#expenseCount").textContent = String(expenses.length);
}

function renderExpenses() {
  const filteredExpenses = getFilteredExpenses();
  list.innerHTML = "";

  if (!filteredExpenses.length) {
    const empty = document.createElement("div");
    empty.className = "panel empty-state";
    empty.textContent = expenses.length
      ? "Nenhuma despesa encontrada com esses filtros."
      : "Cadastre sua primeira despesa para começar o relatório.";
    list.append(empty);
    updateSummary();
    return;
  }

  filteredExpenses.forEach((expense) => {
    const node = template.content.cloneNode(true);
    const card = node.querySelector(".expense-card");
    const statusSelect = node.querySelector(".status-select");

    card.dataset.id = expense.id;
    node.querySelector(".category").textContent = expense.category;
    node.querySelector("h3").textContent = expense.trip;
    node.querySelector(".expense-meta").textContent = `${formatDate(expense.date)} · ${expense.receipt || "Recibo não informado"}`;
    node.querySelector(".amount").textContent = currency(expense.amount);
    node.querySelector(".notes").textContent = expense.notes || "Sem observações.";

    statuses.forEach((status) => {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = status;
      option.selected = status === expense.status;
      statusSelect.append(option);
    });

    list.append(node);
  });

  updateSummary();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = new FormData(form);

  expenses.push({
    id: createId(),
    trip: data.get("trip").trim(),
    date: data.get("date"),
    amount: Number(data.get("amount")),
    category: data.get("category"),
    status: data.get("status"),
    receipt: data.get("receipt").trim(),
    notes: data.get("notes").trim(),
    createdAt: new Date().toISOString(),
  });

  saveExpenses();
  form.reset();
  dateInput.valueAsDate = new Date();
  renderExpenses();
});

list.addEventListener("change", (event) => {
  if (!event.target.matches(".status-select")) return;
  const card = event.target.closest(".expense-card");
  const expense = expenses.find((item) => item.id === card.dataset.id);
  expense.status = event.target.value;
  saveExpenses();
  renderExpenses();
});

list.addEventListener("click", (event) => {
  if (!event.target.matches(".delete-button")) return;
  const card = event.target.closest(".expense-card");
  expenses = expenses.filter((expense) => expense.id !== card.dataset.id);
  saveExpenses();
  renderExpenses();
});

tripFilter.addEventListener("input", renderExpenses);
statusFilter.addEventListener("change", renderExpenses);

exportButton.addEventListener("click", () => {
  const rows = getFilteredExpenses();
  if (!rows.length) return;

  const header = ["Data", "Viagem/Cliente", "Categoria", "Valor", "Status", "Recibo", "Observações"];
  const csvRows = rows.map((expense) =>
    [
      formatDate(expense.date),
      expense.trip,
      expense.category,
      expense.amount.toFixed(2).replace(".", ","),
      expense.status,
      expense.receipt,
      expense.notes,
    ]
      .map((value) => `"${String(value).replaceAll('"', '""')}"`)
      .join(";")
  );

  const blob = new Blob([[header.join(";"), ...csvRows].join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `reembolso-viagem-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
});

clearButton.addEventListener("click", () => {
  if (!expenses.length) return;
  const confirmed = confirm("Deseja apagar todas as despesas salvas neste dispositivo?");
  if (!confirmed) return;
  expenses = [];
  saveExpenses();
  renderExpenses();
});

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

renderExpenses();
