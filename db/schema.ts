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
