import { ADMIN_INTENTS, type Intent, type Urgency } from '../shared/domain'
import type { ClinicSettings } from './settings'

const TZ = 'America/Denver'
const OPEN_HOUR = 8
const CLOSE_HOUR = 17

// Returns the clinic-local wall-clock time as a Date whose UTC fields equal the
// local fields. Business-day math happens in this "local" space.
function toLocal(d: Date): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TZ,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  )
  return new Date(
    Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second),
  )
}

function fromLocal(local: Date, reference: Date): Date {
  const offset = toLocal(reference).getTime() - reference.getTime()
  return new Date(local.getTime() - offset)
}

const isWeekend = (local: Date) => local.getUTCDay() === 0 || local.getUTCDay() === 6

function nextBusinessDay(local: Date): Date {
  const d = new Date(local)
  do d.setUTCDate(d.getUTCDate() + 1)
  while (isWeekend(d))
  return d
}

function atHour(local: Date, hour: number): Date {
  const d = new Date(local)
  d.setUTCHours(hour, 0, 0, 0)
  return d
}

export type SlaClass = 'emergency' | 'urgent' | 'clinical' | 'admin'

export function slaClass(intent: Intent, urgency: Urgency): SlaClass {
  if (urgency === 'emergency') return 'emergency'
  if (urgency === 'urgent') return 'urgent'
  if (ADMIN_INTENTS.includes(intent)) return 'admin'
  return 'clinical'
}

export const SLA_CLASS_LABELS: Record<SlaClass, string> = {
  emergency: 'Emergency — call patient within minutes',
  urgent: 'Urgent — 1 hour',
  clinical: 'Clinical — same business day',
  admin: 'Administrative — 2 business days',
}

// SLA policy: emergency = minutes, urgent = 1 hour, clinical = end of the same
// business day (next business day noon if received late), admin = 2 business days.
export function computeSlaDue(
  intent: Intent,
  urgency: Urgency,
  s: Pick<ClinicSettings, 'sla_emergency_minutes' | 'sla_urgent_minutes'>,
  now = new Date(),
): Date {
  const cls = slaClass(intent, urgency)
  if (cls === 'emergency') return new Date(now.getTime() + s.sla_emergency_minutes * 60_000)
  if (cls === 'urgent') return new Date(now.getTime() + s.sla_urgent_minutes * 60_000)

  const local = toLocal(now)
  const hour = local.getUTCHours()
  const businessToday = !isWeekend(local)

  if (cls === 'clinical') {
    if (businessToday && hour < CLOSE_HOUR - 2) return fromLocal(atHour(local, CLOSE_HOUR), now)
    if (businessToday && hour < OPEN_HOUR) return fromLocal(atHour(local, CLOSE_HOUR), now)
    return fromLocal(atHour(nextBusinessDay(local), 12), now)
  }

  let d = local
  for (let i = 0; i < 2; i++) d = nextBusinessDay(d)
  return fromLocal(atHour(d, CLOSE_HOUR), now)
}

export function localDateKey(d = new Date()): string {
  return toLocal(d).toISOString().slice(0, 10)
}

export function localHour(d = new Date()): number {
  return toLocal(d).getUTCHours()
}
