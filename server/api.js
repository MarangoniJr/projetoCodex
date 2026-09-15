const MAX_RECEIPT = 2 * 1024 * 1024;
const categories = ["Alimentação", "Transporte", "Refeição", "Outros", "Hotel", "Taxi", "Estacionamento", "Pedágio"];
const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const db = (env) => env.DB;

function bad(message) { const error = new Error(message); error.status = 400; throw error; }
function text(value, max = 500) {
  if (typeof value !== "string" || value.length > max) bad("Texto inválido ou muito longo.");
  return value.trim();
}
function number(value) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 10000000) bad("Valor inválido.");
  return value;
}
function expenseData(input) {
  const id = text(input.id, 100);
  if (!/^[a-zA-Z0-9-]+$/.test(id)) bad("Identificador inválido.");
  const date = text(input.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) bad("Data inválida.");
  if (!["normal", "car"].includes(input.type)) bad("Tipo de despesa inválido.");
  if (input.type === "normal" && !categories.includes(input.category)) bad("Categoria inválida.");
  return {
    id, date, type: input.type, category: input.type === "normal" ? input.category : "",
    amount: input.type === "normal" ? number(input.amount) : 0,
    from: input.type === "car" ? text(input.from || "") : "",
    to: input.type === "car" ? text(input.to || "") : "",
    km: input.type === "car" ? number(input.km) : 0,
    carExtra: input.type === "car" ? number(input.carExtra) : 0,
    notes: text(input.notes || "", 3000), receiptName: text(input.receiptName || "", 255),
    createdAt: new Date().toISOString(),
  };
}
function rowData(row) {
  return { ...JSON.parse(row.payload), receiptUrl: row.receipt_key ? `/api/receipts/${encodeURIComponent(row.id)}` : "" };
}
async function readBody(request) {
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) bad("Envie os dados em JSON.");
  // Bound actual bytes, including requests without a Content-Length header.
  const reader = request.body?.getReader();
  if (!reader) bad("Dados ausentes.");
  let size = 0; const chunks = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 3 * 1024 * 1024) { await reader.cancel(); bad("A imagem é muito grande. Escolha uma foto menor."); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { bad("JSON inválido."); }
}

export async function handleApi(request, env) {
  const owner = request.headers.get("oai-authenticated-user-id");
  if (!owner) return json({ error: "Entre na sua conta para acessar as despesas." }, 401);
  const url = new URL(request.url);
  const method = request.method;
  if (!["GET", "HEAD"].includes(method)) {
    const origin = request.headers.get("Origin");
    if ((origin && origin !== url.origin) || request.headers.get("Sec-Fetch-Site") === "cross-site") return json({ error: "Origem não autorizada." }, 403);
  }
  try {
    if (url.pathname === "/api/state" && method === "GET") {
      const [rows, report] = await Promise.all([
        db(env).prepare("SELECT * FROM expenses WHERE owner = ? ORDER BY date, id").bind(owner).all(),
        db(env).prepare("SELECT payload FROM reports WHERE owner = ?").bind(owner).first(),
      ]);
      return json({ expenses: rows.results.map(rowData), report: report ? JSON.parse(report.payload) : {} });
    }
    if (url.pathname === "/api/report" && method === "PUT") {
      const input = await readBody(request); const report = {};
      for (const field of ["reportMonth", "consultant", "route", "company", "kmRate"]) report[field] = text(String(input[field] ?? ""));
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(report.reportMonth)) bad("Mês inválido.");
      number(Number(report.kmRate));
      await db(env).prepare("INSERT INTO reports (owner, payload) VALUES (?, ?) ON CONFLICT(owner) DO UPDATE SET payload = excluded.payload").bind(owner, JSON.stringify(report)).run();
      return json({ report });
    }
    if (url.pathname === "/api/expenses" && method === "POST") {
      const input = await readBody(request); const expense = expenseData(input);
      const existing = await db(env).prepare("SELECT * FROM expenses WHERE owner = ? AND id = ?").bind(owner, expense.id).first();
      if (existing) return json({ expense: rowData(existing) });
      let key = null;
      if (input.receiptData) {
        if (typeof input.receiptData !== "string" || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(input.receiptData)) bad("O comprovante deve ser uma imagem JPEG.");
        const binary = atob(input.receiptData.split(",")[1]);
        if (binary.length > MAX_RECEIPT || binary.length < 3 || binary.charCodeAt(0) !== 255 || binary.charCodeAt(1) !== 216 || binary.charCodeAt(2) !== 255) bad("Imagem inválida ou maior que 2 MB.");
        key = `receipts/${crypto.randomUUID()}.jpg`;
        await env.RECEIPTS.put(key, Uint8Array.from(binary, c => c.charCodeAt(0)), { httpMetadata: { contentType: "image/jpeg" } });
      }
      try {
        await db(env).prepare("INSERT OR IGNORE INTO expenses (owner, id, date, payload, receipt_key) VALUES (?, ?, ?, ?, ?)").bind(owner, expense.id, expense.date, JSON.stringify(expense), key).run();
      } catch (error) {
        if (key) await env.RECEIPTS.delete(key);
        throw error;
      }
      const saved = await db(env).prepare("SELECT * FROM expenses WHERE owner = ? AND id = ?").bind(owner, expense.id).first();
      if (key && saved.receipt_key !== key) await env.RECEIPTS.delete(key);
      return json({ expense: rowData(saved) }, 201);
    }
    const receiptMatch = url.pathname.match(/^\/api\/receipts\/([a-zA-Z0-9-]+)$/);
    if (receiptMatch && method === "GET") {
      const row = await db(env).prepare("SELECT receipt_key FROM expenses WHERE owner = ? AND id = ?").bind(owner, receiptMatch[1]).first();
      const object = row?.receipt_key ? await env.RECEIPTS.get(row.receipt_key) : null;
      if (!object) return json({ error: "Comprovante não encontrado." }, 404);
      return new Response(object.body, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
    }
    const expenseMatch = url.pathname.match(/^\/api\/expenses\/([a-zA-Z0-9-]+)$/);
    if (expenseMatch && method === "DELETE") {
      // Keep the database reference until storage deletion succeeds.
      const row = await db(env).prepare("SELECT receipt_key FROM expenses WHERE owner = ? AND id = ?").bind(owner, expenseMatch[1]).first();
      if (row?.receipt_key) await env.RECEIPTS.delete(row.receipt_key);
      await db(env).prepare("DELETE FROM expenses WHERE owner = ? AND id = ?").bind(owner, expenseMatch[1]).run();
      return json({ ok: true });
    }
    return json({ error: "Rota não encontrada." }, 404);
  } catch (error) {
    if (!error.status) console.error("Expense API failed", error.message);
    return json({ error: error.status ? error.message : "Não foi possível salvar ou carregar os dados. Tente novamente." }, error.status || 500);
  }
}
