import { INTENT_LABELS, ROLE_LABELS, URGENCY_LABELS, type Intent, type Role, type Urgency } from '@shared/domain'

export const roleLabel = (r: string) => ROLE_LABELS[r as Role] ?? (r === 'manager' ? 'Operations Manager' : r)
export const intentLabel = (i: string) => INTENT_LABELS[i as Intent] ?? i
export const urgencyLabel = (u: string) => URGENCY_LABELS[u as Urgency] ?? u

export function timeAgo(iso: string, now = Date.now()) {
  const s = Math.round((now - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${Math.max(s, 0)}s ago`
  if (s < 3600) return `${Math.round(s / 60)}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

export function countdown(iso: string, now = Date.now()) {
  const ms = new Date(iso).getTime() - now
  const abs = Math.abs(ms)
  const h = Math.floor(abs / 3_600_000)
  const m = Math.floor((abs % 3_600_000) / 60_000)
  const s = Math.floor((abs % 60_000) / 1000)
  const text = h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h ? `${h}h ${m}m` : `${m}m ${s.toString().padStart(2, '0')}s`
  return { overdue: ms < 0, text: ms < 0 ? `${text} overdue` : text, ms }
}

export const pct = (x: number | null | undefined) => (x == null ? '—' : `${Math.round(x * 1000) / 10}%`)
