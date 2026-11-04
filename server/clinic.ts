import { and, eq, isNull, sql } from 'drizzle-orm'
import { db, patients, staff, tasks } from '../db'
import type { Role } from '../shared/domain'

export async function getPatient(id: string) {
  const [p] = await db.select().from(patients).where(eq(patients.id, id))
  return p ?? null
}

export async function getStaffMap() {
  const rows = await db.select().from(staff)
  return new Map(rows.map((s) => [s.id, s]))
}

export function ageFromDob(dob: string) {
  const d = new Date(dob)
  const now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  if (now < new Date(now.getFullYear(), d.getMonth(), d.getDate())) age--
  return age
}

// Staff directory with live queue load (open, unacknowledged tasks).
export async function staffDirectory(role?: Role) {
  const loads = await db
    .select({ staffId: tasks.assignedStaffId, n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(eq(tasks.status, 'open'), isNull(tasks.acknowledgedAt)))
    .groupBy(tasks.assignedStaffId)
  const loadMap = new Map(loads.map((l) => [l.staffId, l.n]))
  const rows = await db.select().from(staff)
  return rows
    .filter((s) => s.role !== 'manager' && (!role || s.role === role))
    .map((s) => ({
      id: s.id,
      name: s.name,
      role: s.role,
      title: s.title,
      pod: s.pod,
      available: s.available && s.onDuty,
      charge_nurse: s.isChargeNurse,
      backup_id: s.backupId,
      open_queue: loadMap.get(s.id) ?? 0,
    }))
}

// Picks a person in a role: the patient's own pod/PCP team first, otherwise
// the available person with the lightest queue.
export async function pickAssignee(role: Role, patientId: string | null, preferred?: string | null) {
  const dir = await staffDirectory(role)
  const available = dir.filter((s) => s.available)
  const pool = available.length ? available : dir
  if (preferred) {
    const p = pool.find((s) => s.id === preferred)
    if (p) return p.id
  }
  if (patientId) {
    const patient = await getPatient(patientId)
    if (patient) {
      if (role === 'physician') {
        const pcp = pool.find((s) => s.id === patient.pcpId)
        if (pcp) return pcp.id
      }
      if (role === 'ma') {
        const ma = pool.find((s) => s.id === patient.maId)
        if (ma) return ma.id
      }
    }
  }
  if (role === 'triage_rn') {
    const nonCharge = pool.filter((s) => !s.charge_nurse)
    if (nonCharge.length) return nonCharge.sort((a, b) => a.open_queue - b.open_queue)[0].id
  }
  return pool.sort((a, b) => a.open_queue - b.open_queue)[0]?.id ?? null
}
