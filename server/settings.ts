import { eq } from 'drizzle-orm'
import { db, settings } from '../db'
import { DEFAULT_SETTINGS } from './seed-staff'

export interface ClinicSettings {
  confidence_threshold: number
  sla_emergency_minutes: number
  sla_urgent_minutes: number
  simulate_llm_outage: boolean
  email_new_tasks: boolean
}

export async function getSettings(): Promise<ClinicSettings> {
  const rows = await db.select().from(settings)
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const r of rows) if (r.key !== 'internal_token') merged[r.key] = r.value
  return merged as unknown as ClinicSettings
}

export async function updateSetting(key: keyof ClinicSettings, value: unknown) {
  const existing = await db.select().from(settings).where(eq(settings.key, key))
  if (existing.length) await db.update(settings).set({ value }).where(eq(settings.key, key))
  else await db.insert(settings).values({ key, value })
}
