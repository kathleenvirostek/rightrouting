import { useEffect, useRef, useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  ListChecks,
  ShieldCheck,
  Wrench,
  Zap,
} from 'lucide-react'
import { api } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { AgentStep, AutomationRun } from '@/lib/types'

const KIND_META: Record<string, { icon: typeof Bot; label: string; tone: string }> = {
  plan: { icon: ListChecks, label: 'Task', tone: 'text-primary' },
  llm: { icon: Brain, label: 'Reasoning', tone: 'text-chart-3' },
  tool_call: { icon: Wrench, label: 'Tool call', tone: 'text-foreground' },
  tool_result: { icon: CheckCircle2, label: 'Result', tone: 'text-muted-foreground' },
  guardrail: { icon: ShieldCheck, label: 'Guardrail', tone: 'text-urgency-urgent' },
  decision: { icon: Zap, label: 'Decision', tone: 'text-chart-2' },
  error: { icon: CircleAlert, label: 'Error', tone: 'text-urgency-emergency' },
}

const AGENT_NAME: Record<string, string> = {
  triage: 'Triage & Routing Agent',
  prep: 'Care Team Prep Agent',
}

export function StepRow({ step, showMeta = true, extra }: { step: AgentStep; showMeta?: boolean; extra?: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const meta = KIND_META[step.kind] ?? KIND_META.tool_result
  const Icon = meta.icon
  const hasDetail = step.detail != null
  return (
    <li className="group relative pl-6">
      <Icon className={cn('absolute left-0 top-0.5 size-4', meta.tone)} aria-hidden />
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className={cn('text-[11px] font-semibold uppercase tracking-wide', meta.tone)}>{meta.label}</span>
        {showMeta && step.agent && (
          <span className="text-[11px] text-muted-foreground">
            {AGENT_NAME[step.agent]}
            {step.evalRunId ? ' · eval' : step.messageId ? ` · msg #${step.messageId}` : ''}
          </span>
        )}
        <span className="ml-auto text-[11px] text-muted-foreground">{timeAgo(step.createdAt)}</span>
      </div>
      <p className="text-sm leading-snug">{step.title}</p>
      {hasDetail && (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
            aria-expanded={open}
          >
            <ChevronDown className={cn('size-3 transition-transform motion-reduce:transition-none', open && 'rotate-180')} aria-hidden />
            {open ? 'Hide' : 'Show'} data
          </button>
          {open && (
            <pre className="mt-1 max-h-60 overflow-auto rounded-md bg-muted p-2 text-[11px] leading-relaxed">
              {JSON.stringify(step.detail, null, 2)}
            </pre>
          )}
        </>
      )}
      {extra}
    </li>
  )
}

export function AutomationRunCard({ run }: { run: AutomationRun }) {
  const names: Record<string, string> = {
    safety_screen: 'Automation 1 · Safety Screen & Queue',
    sla_watchdog: 'Automation 2 · SLA Watchdog',
    daily_report: 'Automation 2 · Daily Report',
  }
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold">{names[run.automation]}</span>
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{run.trigger}</span>
        <span
          className={cn(
            'rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide',
            run.status === 'done' ? 'bg-secondary text-secondary-foreground' : run.status === 'failed' ? 'bg-destructive text-white' : 'bg-accent text-accent-foreground',
          )}
        >
          {run.status}
        </span>
        <span className="ml-auto text-[11px] text-muted-foreground">#{run.id} · {timeAgo(run.startedAt)}</span>
      </div>
      <ol className="mt-2 space-y-1">
        {run.steps.map((s, i) => (
          <li key={i} className="flex gap-2 text-xs">
            <span
              className={cn(
                'mt-1 size-2 shrink-0 rounded-full',
                s.status === 'fired' ? 'bg-urgency-emergency' : s.status === 'failed' ? 'bg-urgency-urgent' : s.status === 'skipped' ? 'bg-muted-foreground/40' : 'bg-chart-2',
              )}
              aria-hidden
            />
            <span>
              <span className="font-medium">{s.name}:</span> <span className="text-muted-foreground">{s.detail}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

interface ActivityResponse {
  steps: AgentStep[]
  automations: AutomationRun[]
  runningAgents: number
}

// Live feed of every agent step and automation run, polled every 2 seconds.
export function AgentActivityPanel({ className }: { className?: string }) {
  const [steps, setSteps] = useState<AgentStep[]>([])
  const [autos, setAutos] = useState<AutomationRun[]>([])
  const [running, setRunning] = useState(0)
  const [tab, setTab] = useState<'agents' | 'automations'>('agents')
  const lastId = useRef(0)

  useEffect(() => {
    let stop = false
    const tick = async () => {
      try {
        const r = await api<ActivityResponse>(`/activity?after=${lastId.current}`)
        if (stop) return
        if (r.steps.length) {
          lastId.current = Math.max(lastId.current, ...r.steps.map((s) => s.id))
          setSteps((prev) => {
            const seen = new Set(prev.map((p) => p.id))
            return [...r.steps.filter((s) => !seen.has(s.id)), ...prev].sort((a, b) => b.id - a.id).slice(0, 150)
          })
        }
        setAutos(r.automations)
        setRunning(r.runningAgents)
      } catch {
        /* keep last good state */
      }
    }
    tick()
    const t = setInterval(() => document.visibilityState === 'visible' && tick(), 2000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [])

  return (
    <section aria-labelledby="activity-heading" className={cn('flex flex-col rounded-xl border bg-card', className)}>
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <Bot className="size-4 text-primary" aria-hidden />
        <h2 id="activity-heading" className="text-sm font-semibold">
          Agent activity
        </h2>
        <span className={cn('ml-auto flex items-center gap-1.5 text-xs', running ? 'text-primary' : 'text-muted-foreground')} aria-live="polite">
          <span className={cn('size-2 rounded-full', running ? 'animate-pulse bg-primary motion-reduce:animate-none' : 'bg-muted-foreground/40')} />
          {running ? `${running} agent run${running > 1 ? 's' : ''} in progress` : 'Idle'}
        </span>
      </div>
      <div className="flex gap-1 border-b px-2 py-1.5" role="tablist" aria-label="Activity type">
        {(['agents', 'automations'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn('rounded-md px-2.5 py-1 text-xs font-medium', tab === t ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
          >
            {t === 'agents' ? 'Agent steps' : 'Automation runs'}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'agents' ? (
          steps.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No agent activity yet. Submit a portal message to watch the agents work.</p>
          ) : (
            <ul className="space-y-3">
              {steps.map((s) => (
                <StepRow
                  key={s.id}
                  step={s}
                  extra={
                    s.messageId && s.kind === 'decision' ? (
                      <Link to="/messages/$messageId" params={{ messageId: String(s.messageId) }} className="block text-[11px] text-primary hover:underline">
                        Open message #{s.messageId}
                      </Link>
                    ) : null
                  }
                />
              ))}
            </ul>
          )
        ) : autos.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No automation runs yet.</p>
        ) : (
          <div className="space-y-2">
            {autos.map((a) => (
              <AutomationRunCard key={a.id} run={a} />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
