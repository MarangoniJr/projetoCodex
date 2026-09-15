const json = (data, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
export function isAdmin(request, env) {
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  return Boolean(request.headers.get("oai-authenticated-user-id") && env.ADMIN_EMAIL && email === env.ADMIN_EMAIL.trim().toLowerCase());
}
function invalid(message) { const error = new Error(message); error.status = 400; throw error; }
const fields = {
  expenses: { id: "id", date: "date", payload: "payload", receipt_key: "receipt_key", ...Object.fromEntries(["type", "category", "amount", "from", "to", "km", "carExtra", "notes", "receiptName", "createdAt"].map(key => [key.toLowerCase(), `json_extract(payload, '$.${key}')`])) },
  reports: { payload: "payload", ...Object.fromEntries(["reportMonth", "consultant", "route", "company", "kmRate"].map(key => [key.toLowerCase(), `json_extract(payload, '$.${key}')`])) },
};

// A small SELECT grammar, not a blacklist. Only server-built SQL reaches D1.
export function compileQuery(sql, owner) {
  if (typeof sql !== "string" || sql.length > 8000) invalid("A consulta deve ter até 8.000 caracteres.");
  const tokens = []; let position = 0;
  const pattern = /\s+|'(?:''|[^'])*'|[A-Za-z_][A-Za-z_0-9]*|-?\d+(?:\.\d+)?|>=|<=|<>|!=|[=><*(),;]/y;
  while (position < sql.length) {
    pattern.lastIndex = position;
    const match = pattern.exec(sql);
    if (!match) invalid("Sintaxe não suportada. Use os exemplos da tela.");
    position = pattern.lastIndex;
    if (!/^\s+$/.test(match[0])) tokens.push(match[0]);
  }
  let i = 0;
  const peek = () => tokens[i]?.toUpperCase();
  const expect = value => { if (peek() !== value) invalid(`Esperado: ${value}.`); i++; };
  function expression() {
    const token = tokens[i++];
    if (!token) invalid("Informe uma coluna.");
    if (token.toUpperCase() === "JSON_EXTRACT") {
      expect("("); expect("PAYLOAD"); expect(",");
      const path = tokens[i++]; expect(")");
      if (!/^'\$\.[A-Za-z_][A-Za-z_0-9]*'$/.test(path || "")) invalid("Caminho JSON inválido.");
      return { field: path.slice(3, -1).toLowerCase() };
    }
    if (!/^[a-z_][a-z_0-9]*$/i.test(token)) invalid("Coluna inválida.");
    return { field: token.toLowerCase() };
  }
  expect("SELECT");
  const columns = [];
  const star = peek() === "*";
  if (star) i++;
  else {
    do {
      if (columns.length) expect(",");
      const column = expression();
      if (peek() === "AS") {
        i++; column.alias = tokens[i++];
        if (!/^[a-z_][a-z_0-9]*$/i.test(column.alias || "")) invalid("Apelido de coluna inválido.");
      }
      columns.push(column);
      if (columns.length > 20) invalid("Selecione até 20 colunas.");
    } while (peek() === ",");
  }
  expect("FROM");
  const table = tokens[i++]?.toLowerCase();
  if (!Object.hasOwn(fields, table || "")) invalid("Escolha a tabela expenses ou reports.");
  const resolve = column => {
    if (!Object.hasOwn(fields[table], column.field)) invalid(`Coluna não disponível: ${column.field}.`);
    return fields[table][column.field];
  };
  const defaultColumns = table === "expenses" ? ["id", "date", "type", "category", "amount", "km", "carextra", "notes", "receipt_key"] : ["reportmonth", "consultant", "route", "company", "kmrate"];
  const selected = star ? defaultColumns.map(field => ({ field })) : columns;
  const names = selected.map(column => column.alias || column.field);
  if (new Set(names.map(name => name.toLowerCase())).size !== names.length) invalid("Use nomes diferentes para as colunas selecionadas.");
  let query = `SELECT ${selected.map(column => `${resolve(column)} AS "${column.alias || column.field}"`).join(", ")} FROM ${table} WHERE owner = ?`;
  const values = [owner];
  if (peek() === "WHERE") {
    i++;
    do {
      const column = expression(); const op = tokens[i++]?.toUpperCase();
      if (!["=", "!=", "<>", ">", "<", ">=", "<=", "LIKE"].includes(op)) invalid("Use =, !=, >, <, >=, <= ou LIKE.");
      const literal = tokens[i++]; let value;
      if (/^'(?:''|[^'])*'$/.test(literal || "")) value = literal.slice(1, -1).replaceAll("''", "'");
      else if (/^-?\d+(?:\.\d+)?$/.test(literal || "") && Number.isFinite(Number(literal))) value = Number(literal);
      else invalid("Use texto entre aspas simples ou um número no filtro.");
      query += ` AND ${resolve(column)} ${op} ?`; values.push(value);
      if (peek() !== "AND") break;
      i++;
    } while (true);
  }
  if (peek() === "ORDER") {
    i++; expect("BY"); const column = expression();
    const direction = ["ASC", "DESC"].includes(peek()) ? tokens[i++].toUpperCase() : "ASC";
    query += ` ORDER BY ${resolve(column)} ${direction}`;
  }
  let limit = 100;
  if (peek() === "LIMIT") {
    i++; const token = tokens[i++];
    if (!/^\d+$/.test(token || "") || Number(token) < 1 || Number(token) > 200) invalid("LIMIT deve estar entre 1 e 200.");
    limit = Number(token);
  }
  if (peek() === ";") i++;
  if (i !== tokens.length) invalid("Use um SELECT por vez. São aceitos WHERE com AND, ORDER BY e LIMIT.");
  query += " LIMIT ?"; values.push(limit + 1);
  const editable = table === "reports" || selected.some(column => column.field === "id" && (!column.alias || column.alias === "id"));
  return { query, values, table, limit, columns: names, editable };
}

export async function handleAdmin(request, env, owner, { readBody, expenseData, reportData }) {
  if (!isAdmin(request, env)) return json({ error: "Área exclusiva do administrador deste aplicativo." }, 403);
  const path = new URL(request.url).pathname;
  if (path === "/api/admin/query" && request.method === "POST") {
    const input = await readBody(request);
    const compiled = compileQuery(input?.sql, owner);
    const result = await env.DB.prepare(compiled.query).bind(...compiled.values).all();
    return json({ table: compiled.table, columns: compiled.columns, rows: result.results.slice(0, compiled.limit), hasMore: result.results.length > compiled.limit, limit: compiled.limit, editable: compiled.editable });
  }
  const match = path.match(/^\/api\/admin\/records\/(expenses|reports)(?:\/([a-zA-Z0-9-]+))?$/);
  if (!match) return json({ error: "Rota não encontrada." }, 404);
  const [, table, id] = match;
  if ((table === "expenses" && !id) || (table === "reports" && id)) invalid("Registro inválido.");
  const where = table === "expenses" ? "owner = ? AND id = ?" : "owner = ?";
  const params = table === "expenses" ? [owner, id] : [owner];
  const row = await env.DB.prepare(`SELECT payload FROM ${table} WHERE ${where}`).bind(...params).first();
  if (!row) return json({ error: "Registro não encontrado." }, 404);
  if (request.method === "GET") return json({ data: JSON.parse(row.payload), version: row.payload });
  if (request.method !== "PUT") return json({ error: "Método não permitido." }, 405);
  const input = await readBody(request);
  if (typeof input?.version !== "string" || input.version !== row.payload) return json({ error: "Este registro mudou. Reabra a edição para carregar os dados atuais." }, 409);
  if (!input.data || typeof input.data !== "object" || Array.isArray(input.data)) invalid("Dados inválidos.");
  const original = JSON.parse(row.payload);
  let updated;
  if (table === "expenses") {
    updated = expenseData({ ...input.data, id, receiptName: original.receiptName });
    updated.createdAt = original.createdAt;
  } else updated = reportData(input.data);
  const statement = table === "expenses" ? "UPDATE expenses SET date = ?, payload = ? WHERE owner = ? AND id = ? AND payload = ?" : "UPDATE reports SET payload = ? WHERE owner = ? AND payload = ?";
  const args = table === "expenses" ? [updated.date, JSON.stringify(updated), owner, id, input.version] : [JSON.stringify(updated), owner, input.version];
  const result = await env.DB.prepare(statement).bind(...args).run();
  if ((result.meta?.changes ?? result.changes) !== 1) return json({ error: "O registro mudou durante a edição. Reabra e tente novamente." }, 409);
  return json({ data: updated, version: JSON.stringify(updated) });
}
