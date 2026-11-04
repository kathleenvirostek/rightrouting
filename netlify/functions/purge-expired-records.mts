import type { Config } from "@netlify/functions";
import { getDatabase } from "@netlify/database";

// Daily retention job: removes or scrubs copies of patient text held in
// log/trace tables (agent runs and steps, automation runs, eval results,
// audit detail, notifications, routing corrections). Retention periods
// live in the `retention_days` row of the settings table.
export default async () => {
  const db = getDatabase();
  const [row] = await db.sql`SELECT purge_expired_records() AS result`;
  // Log row counts only — never record contents.
  console.log("Retention purge complete", JSON.stringify(row?.result ?? {}));
};

export const config: Config = {
  schedule: "@daily",
};
