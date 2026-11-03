import { ne, sql } from 'drizzle-orm'
import { db, patients, staff, routingRules, settings } from '../db'
import { SEED_PATIENTS } from '../db/seed-patients'
import { SEED_STAFF, SEED_RULES, DEFAULT_SETTINGS } from './seed-staff'

let seededThisInstance = false

// Seeds reference data (patients, staff, rules, settings) the first time the
// API is hit on an empty database. Messages are never seeded: they always go
// through the live pipeline so every routing decision is produced by the agents.
export async function ensureSeeded() {
  if (seededThisInstance) return
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(staff)
  if (count === 0) await seedReferenceData()
  seededThisInstance = true
}

async function seedReferenceData() {
  await db
    .insert(staff)
    .values(
      SEED_STAFF.map((s) => ({
        id: s.id,
        name: s.name,
        role: s.role,
        title: s.title,
        email: `${s.id.toLowerCase()}@rightroute-demo.example`,
        pod: s.pod,
        isChargeNurse: s.isChargeNurse ?? false,
        backupId: s.backupId,
        shift: s.shift,
      })),
    )
    .onConflictDoNothing()
  await db.insert(patients).values(SEED_PATIENTS).onConflictDoNothing()
  await db.insert(routingRules).values(SEED_RULES.map((text) => ({ text })))
  await db
    .insert(settings)
    .values(Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ key, value })))
    .onConflictDoNothing()
}

// Wipes all operational data and restores the reference data. Used by the
// manager's "Reset demo" button before a rehearsal.
export async function resetDemo(keepCorrections: boolean) {
  const operational = [
    'messages',
    'tasks',
    'agent_runs',
    'agent_steps',
    'automation_runs',
    'notifications',
    'audit_log',
    'eval_runs',
    'staff',
    'patients',
    'routing_rules',
  ]
  if (!keepCorrections) operational.push('corrections')
  await db.execute(sql.raw(`TRUNCATE ${operational.join(', ')} RESTART IDENTITY`))
  // Keep the internal token so warm function instances stay in sync.
  await db.delete(settings).where(ne(settings.key, 'internal_token'))
  seededThisInstance = false
  await seedReferenceData()
  seededThisInstance = true
}
