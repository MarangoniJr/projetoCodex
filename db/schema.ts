import { sqliteTable, text, primaryKey, index } from "drizzle-orm/sqlite-core";

export const expenses = sqliteTable("expenses", {
  owner: text("owner").notNull(),
  id: text("id").notNull(),
  date: text("date").notNull(),
  payload: text("payload").notNull(),
  receiptKey: text("receipt_key"),
}, (table) => [
  primaryKey({ columns: [table.owner, table.id] }),
  index("idx_expenses_owner_date").on(table.owner, table.date),
]);

export const reports = sqliteTable("reports", {
  owner: text("owner").primaryKey(),
  payload: text("payload").notNull(),
});

export const clients = sqliteTable("clients", {
  owner: text("owner").notNull(),
  name: text("name").notNull(),
}, table => [primaryKey({ columns: [table.owner, table.name] })]);

export const projects = sqliteTable("projects", {
  owner: text("owner").notNull(),
  client: text("client").notNull(),
  name: text("name").notNull(),
}, table => [primaryKey({ columns: [table.owner, table.client, table.name] })]);
