import { useEffect, useState } from 'react'
import { AlertTriangle, Clock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { countdown, roleLabel, urgencyLabel } from '@/lib/format'

const URGENCY_STYLES: Record<string, string> = {
  emergency: 'bg-urgency-emergency text-white',
  urgent: 'bg-urgency-urgent text-white',
  same_day: 'bg-urgency-same-day text-foreground',
  routine: 'bg-muted text-muted-foreground border border-border',
}

export function UrgencyBadge({ urgency, className }: { urgency: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
        URGENCY_STYLES[urgency] ?? URGENCY_STYLES.routine,
        className,
      )}
    >
      {urgency === 'emergency' && <AlertTriangle className="size-3" aria-hidden />}
      {urgencyLabel(urgency)}
    </span>
  )
}

export function RolePill({ role, className }: { role: string; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground', className)}>
      {roleLabel(role)}
    </span>
  )
}

export function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const tone = value >= 0.85 ? 'bg-chart-2' : value >= 0.7 ? 'bg-chart-4' : 'bg-urgency-emergency'
  return (
    <div className="flex items-center gap-2" title={`Routing confidence ${pct}%`}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Routing confidence">
        <div className={cn('h-full rounded-full', tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
    </div>
  )
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}

export function SlaTimer({ dueAt, done }: { dueAt: string; done?: boolean }) {
  const now = useNow()
  if (done) return <span className="text-xs text-muted-foreground">Acknowledged</span>
  const c = countdown(dueAt, now)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-xs font-medium tabular-nums',
        c.overdue ? 'text-urgency-emergency' : c.ms < 15 * 60_000 ? 'text-urgency-urgent' : 'text-muted-foreground',
      )}
    >
      <Clock className="size-3" aria-hidden />
      <span className="sr-only">SLA </span>
      {c.text}
    </span>
  )
}
