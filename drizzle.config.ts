// Plain config object (no import from 'drizzle-kit') so the config loads even
// when drizzle-kit is run via npx without the project's dependencies installed.
export default {
  dialect: 'postgresql',
  schema: './db/schema.ts',
  out: 'netlify/database/migrations',
}
