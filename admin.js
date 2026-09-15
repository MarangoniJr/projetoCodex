const $ = selector => document.querySelector(selector);
const examples = {
  expenses: "SELECT * FROM expenses ORDER BY date DESC LIMIT 100;",
  food: "SELECT id, date, category, amount, notes FROM expenses WHERE category = 'Alimentação' ORDER BY date DESC LIMIT 100;",
  car: "SELECT id, date, km, carExtra, notes FROM expenses WHERE type = 'car' ORDER BY date DESC LIMIT 100;",
  reports: "SELECT * FROM reports;",
};
let editing = null;
let pendingData = null;
let saving = false;
let lastQuery = null;
const fieldDefinitions = {
  expenses: [
    ["date", "Data", "date"], ["type", "Tipo", ["normal", "car"]],
    ["category", "Categoria", ["Alimentação", "Transporte", "Refeição", "Outros", "Hotel", "Taxi", "Estacionamento", "Pedágio"]],
    ["amount", "Valor (R$)", "number"], ["from", "Origem", "text"], ["to", "Destino", "text"],
    ["km", "Quilômetros", "number"], ["carExtra", "Estacionamento / pedágio (R$)", "number"], ["notes", "Observações", "textarea"],
  ],
  reports: [["reportMonth", "Mês de referência", "month"], ["consultant", "Consultor", "text"], ["route", "Viagem de/para", "text"], ["company", "Empresa/local", "text"], ["kmRate", "Taxa por quilômetro (R$)", "number"]],
};
function status(message, error = false) { $("#adminStatus").textContent = message; $("#adminStatus").classList.toggle("error", error); }
async function api(path, options = {}) {
  let response;
  try { response = await fetch(path, { ...options, headers: { "Content-Type": "application/json" }, cache: "no-store" }); }
  catch { throw new Error("Sem conexão. Tente novamente quando estiver online."); }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.error || "Não foi possível acessar os dados. Entre na sua conta novamente.");
  return data;
}
function makeTable(columns, rows) {
  const table = document.createElement("table");
  const head = table.createTHead().insertRow();
  for (const name of columns) { const th = document.createElement("th"); th.scope = "col"; th.textContent = name; head.append(th); }
  const body = table.createTBody();
  for (const row of rows) {
    const tr = body.insertRow();
    for (const name of columns) { const td = tr.insertCell(); const value = row[name]; if (value instanceof Node) td.append(value); else td.textContent = value == null ? "—" : String(value); }
  }
  return table;
}
async function query(sql) {
  $("#runQuery").disabled = true;
  status("Consultando dados...");
  try {
    const result = await api("/api/admin/query", { method: "POST", body: JSON.stringify({ sql }) });
    lastQuery = sql;
    const canEdit = result.editable;
    // The action column is separate from SQL aliases to avoid overwriting returned data.
    const table = makeTable(result.columns, result.rows);
    if (canEdit) {
      const th = document.createElement("th"); th.textContent = "Ações"; th.scope = "col"; table.tHead.rows[0].append(th);
      result.rows.forEach((row, index) => {
        const button = document.createElement("button"); button.type = "button"; button.className = "edit-row"; button.textContent = "Editar";
        button.addEventListener("click", async () => { button.disabled = true; await openEditor(result.table, row.id); button.disabled = false; });
        table.tBodies[0].rows[index].insertCell().append(button);
      });
    }
    $("#resultTable").replaceChildren(table);
    $("#resultCount").textContent = result.rows.length ? `${result.rows.length} registro(s)${result.hasMore ? "; há mais resultados. Refine o WHERE ou aumente o LIMIT." : "."}` : "Nenhum registro encontrado.";
    status(canEdit ? "Consulta concluída. Use Editar para alterar um registro." : "Consulta concluída. Inclua a coluna id para editar despesas.");
  } catch (error) { status(error.message, true); }
  finally { $("#runQuery").disabled = false; }
}
$("#queryForm").addEventListener("submit", event => { event.preventDefault(); query($("#sql").value); });
document.querySelectorAll("[data-example]").forEach(button => button.addEventListener("click", () => { $("#sql").value = examples[button.dataset.example]; $("#sql").focus(); }));

function toggleFields() {
  if (editing?.table !== "expenses") return;
  const car = $("#field-type").value === "car";
  for (const key of ["category", "amount", "from", "to", "km", "carExtra"]) {
    const input = $(`#field-${key}`); const visible = ["category", "amount"].includes(key) ? !car : car;
    input.disabled = !visible; input.parentElement.hidden = !visible;
  }
}
async function openEditor(table, id) {
  try {
    const path = `/api/admin/records/${table}${table === "expenses" ? `/${encodeURIComponent(id)}` : ""}`;
    const record = await api(path);
    editing = { ...record, table, path }; pendingData = null;
    $("#editTitle").textContent = table === "expenses" ? "Editar despesa" : "Editar dados do relatório";
    $("#editStatus").textContent = table === "expenses" ? `Registro ${id}. O comprovante será mantido.` : "A taxa de quilometragem é usada nos cálculos de todos os meses.";
    $("#editStatus").classList.remove("error");
    $("#editFields").replaceChildren();
    for (const [key, labelText, type] of fieldDefinitions[table]) {
      const label = document.createElement("label"); label.textContent = labelText;
      const input = document.createElement(Array.isArray(type) ? "select" : type === "textarea" ? "textarea" : "input");
      input.id = `field-${key}`; input.name = key;
      if (Array.isArray(type)) {
        for (const value of type) { const option = document.createElement("option"); option.value = value; option.textContent = value === "normal" ? "Despesa realizada" : value === "car" ? "Carro próprio" : value; input.append(option); }
      } else if (type !== "textarea") input.type = type;
      else { input.rows = 3; label.className = "wide"; }
      if (type === "number") { input.min = "0"; input.max = "10000000"; input.step = "0.01"; input.inputMode = "decimal"; }
      if (type === "text" || type === "textarea") input.maxLength = key === "notes" ? 3000 : 500;
      input.required = ["date", "type", "category", "amount", "km", "carExtra", "reportMonth", "kmRate"].includes(key);
      input.value = record.data[key] ?? "";
      label.append(input); $("#editFields").append(label);
    }
    $("#field-type")?.addEventListener("change", toggleFields);
    setReview(false); toggleFields(); $("#editDialog").showModal();
  } catch (error) { status(error.message, true); }
}
function setReview(review) {
  $("#changesPanel").hidden = !review;
  $("#backToEdit").hidden = !review;
  $("#confirmEdit").hidden = !review;
  $("#reviewEdit").hidden = review;
  $("#editFields").hidden = review;
}
$("#editForm").addEventListener("submit", event => {
  event.preventDefault(); if (saving || !editing) return;
  const data = { ...editing.data };
  for (const [key, , type] of fieldDefinitions[editing.table]) {
    const input = $(`#field-${key}`);
    data[key] = type === "number" && key !== "kmRate" ? Number(input.value) : input.value.trim();
  }
  if (editing.table === "expenses") {
    if (data.type === "normal") { data.from = ""; data.to = ""; data.km = 0; data.carExtra = 0; }
    else { data.category = ""; data.amount = 0; }
  }
  const changes = fieldDefinitions[editing.table].filter(([key]) => String(data[key] ?? "") !== String(editing.data[key] ?? "")).map(([key, label]) => ({ Campo: label, Antes: editing.data[key] ?? "", Depois: data[key] }));
  if (!changes.length) { $("#editStatus").textContent = "Nenhum campo foi alterado."; return; }
  pendingData = data;
  $("#changesTable").replaceChildren(makeTable(["Campo", "Antes", "Depois"], changes));
  $("#editStatus").textContent = "Confira os valores abaixo antes de confirmar a gravação.";
  setReview(true); $("#confirmEdit").focus();
});
$("#backToEdit").addEventListener("click", () => { if (!saving) { setReview(false); pendingData = null; } });
$("#cancelEdit").addEventListener("click", () => { if (!saving) $("#editDialog").close(); });
$("#editDialog").addEventListener("cancel", event => { if (saving) event.preventDefault(); });
$("#confirmEdit").addEventListener("click", async () => {
  if (saving || !pendingData) return;
  saving = true;
  for (const id of ["confirmEdit", "backToEdit", "cancelEdit"]) $(`#${id}`).disabled = true;
  $("#editStatus").textContent = "Salvando alterações...";
  try {
    await api(editing.path, { method: "PUT", body: JSON.stringify({ data: pendingData, version: editing.version }) });
    $("#editDialog").close(); editing = null; pendingData = null;
    if (lastQuery) await query(lastQuery);
    status("Alterações salvas. As despesas já usam os novos dados.");
  } catch (error) { $("#editStatus").textContent = error.message; $("#editStatus").classList.add("error"); }
  finally { saving = false; for (const id of ["confirmEdit", "backToEdit", "cancelEdit"]) $(`#${id}`).disabled = false; }
});
(async () => {
  try {
    const state = await api("/api/state");
    if (!state.isAdmin) throw new Error("Área exclusiva do administrador deste aplicativo.");
    $("#adminContent").hidden = false;
    await query(examples.expenses);
  } catch (error) { status(error.message, true); }
})();
