import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { FastForward, Loader2, Mail, Play, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AutomationRunCard } from '@/components/agent-activity'
import { useApp } from '@/lib/app-context'
import { api } from '@/lib/api'
import { usePoll } from '@/lib/use-poll'
import { pct, roleLabel, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { AutomationRun, Settings, Staff } from '@/lib/types'

export const Route = createFileRoute('/manager')({
  head: () => ({ meta: [{ title: 'Manager · RightRoute' }] }),
  component: ManagerPage,
})

function ManagerPage() {
  const { isManager, setPersonaId, boot } = useApp()
  if (boot && !isManager)
    return (
      <div className="mx-auto max-w-reading px-4 py-16 text-center sm:px-6">
        <h1 className="font-display text-2xl font-bold">Manager view</h1>
        <p className="mt-2 text-muted-foreground">This page is for the clinic operations manager. Switch roles to continue.</p>
        <Button className="mt-5" onClick={() => setPersonaId('S14')}>
          Sign in as Nicole Brandt (Operations Manager)
        </Button>
      </div>
    )
  return (
    <div className="mx-auto max-w-content px-4 py-8 sm:px-6">
      <h1 className="font-display text-3xl font-bold tracking-tight">Clinic operations</h1>
      <p className="mt-1 text-muted-foreground">Analytics, routing rules, staffing, automations and evidence that routing is learning.</p>
      <Tabs defaultValue="analytics" className="mt-6">
        <TabsList className="flex h-auto w-full flex-wrap justify-start">
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="rules">Routing rules</TabsTrigger>
          <TabsTrigger value="staff">Staff & availability</TabsTrigger>
          <TabsTrigger value="automations">Automations</TabsTrigger>
          <TabsTrigger value="learning">Corrections & audit</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="analytics" className="mt-4">
          <Analytics />
        </TabsContent>
        <TabsContent value="rules" className="mt-4">
          <Rules />
        </TabsContent>
        <TabsContent value="staff" className="mt-4">
          <StaffTab />
        </TabsContent>
        <TabsContent value="automations" className="mt-4">
          <Automations />
        </TabsContent>
        <TabsContent value="learning" className="mt-4">
          <Learning />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <SettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---------------------------------------------------------------- analytics

interface AnalyticsData {
  totals: { messages: number; tasks: number; emergencies: number; fallback: number; needsReview: number; multiIntentMessages: number }
  byCategory: { intent: string; label: string; count: number }[]
  byRole: { role: string; label: string; count: number; open: number }[]
  physician: { beforeCount: number; beforePct: number; afterCount: number; afterPct: number }
  reroute: { corrections: number; agentTasks: number; ratePct: number; batches: { label: string; ratePct: number; tasks: number }[] }
  sla: { breached: number; overdueNow: number; breachRatePct: number }
  evals: { id: number; accuracy: number | null; emergencyRecall: number | null; physicianPct: number | null; correctionsAvailable: number }[]
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-1 font-display text-3xl font-bold tabular-nums', tone)}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}

function HBars({ rows, color = 'bg-chart-1', suffix = '' }: { rows: { label: string; value: number }[]; color?: string; suffix?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[9rem_1fr_3rem] items-center gap-3 text-sm">
          <span className="truncate text-muted-foreground">{r.label}</span>
          <span className="h-3 overflow-hidden rounded-sm bg-muted">
            <span className={cn('block h-full rounded-sm', color)} style={{ width: `${(r.value / max) * 100}%` }} />
          </span>
          <span className="text-right tabular-nums">
            {r.value}
            {suffix}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Analytics() {
  const { data, error } = usePoll(() => api<AnalyticsData>('/analytics'), 6000)
  if (error) return <p className="text-destructive">{error}</p>
  if (!data) return <div className="h-64 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
  const a = data
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Messages received" value={String(a.totals.messages)} sub={`${a.totals.tasks} tasks · ${a.totals.multiIntentMessages} split multi-intent`} />
        <Stat
          label="Sent to physicians"
          value={`${a.physician.beforePct}% → ${a.physician.afterPct}%`}
          sub={`Before (legacy portal routing): ${a.physician.beforeCount} msgs · With RightRoute: ${a.physician.afterCount} tasks`}
          tone="text-primary"
        />
        <Stat label="Reroute rate" value={`${a.reroute.ratePct}%`} sub={`${a.reroute.corrections} staff corrections of ${a.reroute.agentTasks} AI-routed tasks`} />
        <Stat
          label="SLA breaches"
          value={String(a.sla.breached)}
          sub={`${a.sla.overdueNow} overdue right now · ${a.totals.emergencies} emergency screens fired`}
          tone={a.sla.breached ? 'text-urgency-urgent' : undefined}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Volume by category</h2>
          <div className="mt-4">
            <HBars rows={a.byCategory.map((c) => ({ label: c.label, value: c.count }))} />
          </div>
        </section>
        <section className="rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Tasks by role (open in parentheses)</h2>
          <ul className="mt-4 space-y-2">
            {a.byRole.map((r) => {
              const max = Math.max(1, ...a.byRole.map((x) => x.count))
              return (
                <li key={r.role} className="grid grid-cols-[9rem_1fr_4rem] items-center gap-3 text-sm">
                  <span className="truncate text-muted-foreground">{r.label}</span>
                  <span className="h-3 overflow-hidden rounded-sm bg-muted">
                    <span className={cn('block h-full rounded-sm', r.role === 'physician' ? 'bg-chart-5' : 'bg-chart-2')} style={{ width: `${(r.count / max) * 100}%` }} />
                  </span>
                  <span className="text-right tabular-nums">
                    {r.count} ({r.open})
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Is it learning? Reroute rate per batch of 10 routed tasks</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Each reroute becomes a labeled example the agent retrieves for similar messages. A falling rate means staff need to correct it less often.
          </p>
          {a.reroute.batches.length === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">No routed tasks yet.</p>
          ) : (
            <div className="mt-4 flex h-44 items-end gap-2 border-b border-l pl-2" role="img" aria-label={`Reroute rate by batch: ${a.reroute.batches.map((b) => `${b.label}: ${b.ratePct}%`).join(', ')}`}>
              {a.reroute.batches.map((b) => (
                <div key={b.label} className="flex flex-1 flex-col items-center justify-end gap-1">
                  <span className="text-[11px] tabular-nums">{b.ratePct}%</span>
                  <div className="w-full max-w-10 rounded-t-sm bg-chart-3" style={{ height: `${Math.max(2, b.ratePct) * 1.2}px` }} />
                  <span className="text-[10px] text-muted-foreground">{b.label}</span>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Evaluation accuracy over time</h2>
          <p className="mt-1 text-xs text-muted-foreground">30-case labeled test set. Run it again after staff corrections to show improvement.</p>
          {a.evals.length === 0 ? (
            <p className="mt-6 text-sm text-muted-foreground">No evaluation runs yet. Use the Evaluate page.</p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 font-medium">Run</th>
                  <th className="py-1 font-medium">Corrections known</th>
                  <th className="py-1 font-medium">Accuracy</th>
                  <th className="py-1 font-medium">Emergency recall</th>
                  <th className="py-1 font-medium">% physician</th>
                </tr>
              </thead>
              <tbody>
                {a.evals.map((e) => (
                  <tr key={e.id} className="border-t">
                    <td className="py-1.5">#{e.id}</td>
                    <td className="py-1.5 tabular-nums">{e.correctionsAvailable}</td>
                    <td className="py-1.5 font-semibold tabular-nums">{pct(e.accuracy)}</td>
                    <td className="py-1.5 tabular-nums">{pct(e.emergencyRecall)}</td>
                    <td className="py-1.5 tabular-nums">{pct(e.physicianPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
      <p className="text-xs text-muted-foreground">
        “Before” is what legacy portal routing would do: medical-advice and prescription-renewal messages go to the PCP inbox based on the type the patient
        picked. “With RightRoute” is the share of tasks the agents actually assigned to a physician.
      </p>
    </div>
  )
}

// -------------------------------------------------------------------- rules

interface Rule {
  id: number
  text: string
  enabled: boolean
  createdBy: string
  updatedAt: string
}

function Rules() {
  const { data, refresh } = usePoll(() => api<Rule[]>('/rules'), 0)
  const [text, setText] = useState('')
  const add = async () => {
    if (!text.trim()) return
    try {
      await api('/rules', { body: { text } })
      setText('')
      toast.success('Rule added. The agent reads it on the next message.')
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    }
  }
  const patch = async (id: number, body: Partial<Rule>) => {
    await api(`/rules/${id}`, { method: 'PATCH', body })
    refresh()
  }
  const remove = async (id: number) => {
    await api(`/rules/${id}`, { method: 'DELETE' })
    toast.success('Rule deleted')
    refresh()
  }
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Plain-language routing rules</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The Triage & Routing Agent must call get_routing_rules before every decision, and these rules override its defaults.
        </p>
        <ul className="mt-4 divide-y">
          {data?.map((r) => (
            <RuleRow key={r.id} rule={r} onSave={(t) => patch(r.id, { text: t })} onToggle={(v) => patch(r.id, { enabled: v })} onDelete={() => remove(r.id)} />
          ))}
        </ul>
      </section>
      <section className="h-fit rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Add a rule</h2>
        <Label htmlFor="new-rule" className="sr-only">
          New rule
        </Label>
        <Textarea
          id="new-rule"
          className="mt-3"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Questions about COVID or flu vaccine availability go to the Front Desk."
          maxLength={500}
        />
        <Button className="mt-3" onClick={add} disabled={!text.trim()}>
          <Plus aria-hidden /> Add rule
        </Button>
      </section>
    </div>
  )
}

function RuleRow({ rule, onSave, onToggle, onDelete }: { rule: Rule; onSave: (t: string) => void; onToggle: (v: boolean) => void; onDelete: () => void }) {
  const [text, setText] = useState(rule.text)
  const dirty = text !== rule.text
  return (
    <li className="flex gap-3 py-3">
      <Switch checked={rule.enabled} onCheckedChange={onToggle} aria-label={rule.enabled ? 'Disable rule' : 'Enable rule'} className="mt-2" />
      <div className="flex-1">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} className={cn(!rule.enabled && 'opacity-50')} aria-label={`Rule ${rule.id}`} />
        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
          Rule #{rule.id} · by {rule.createdBy} · updated {timeAgo(rule.updatedAt)}
          {dirty && (
            <Button size="xs" onClick={() => onSave(text)}>
              Save
            </Button>
          )}
        </div>
      </div>
      <Button size="icon-sm" variant="ghost" onClick={onDelete} aria-label={`Delete rule ${rule.id}`}>
        <Trash2 aria-hidden />
      </Button>
    </li>
  )
}

// -------------------------------------------------------------------- staff

function StaffTab() {
  const { reloadBoot } = useApp()
  const { data, refresh } = usePoll(() => api<{ staff: Staff[] }>('/bootstrap').then((b) => b.staff), 0)
  const toggle = async (s: Staff, available: boolean) => {
    await api(`/staff/${s.id}`, { method: 'PATCH', body: { available } })
    toast.success(`${s.name} is now ${available ? 'available' : 'unavailable'} — the agent will route around them`)
    refresh()
    reloadBoot()
  }
  const name = (id: string | null) => data?.find((s) => s.id === id)?.name ?? '—'
  return (
    <section className="rounded-xl border bg-card p-5">
      <h2 className="font-semibold">Staff directory</h2>
      <p className="mt-1 text-sm text-muted-foreground">Mark someone unavailable to see the agent pick another person, and the watchdog use the backup.</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr>
              <th className="py-2 font-medium">Name</th>
              <th className="py-2 font-medium">Role</th>
              <th className="py-2 font-medium">Title</th>
              <th className="py-2 font-medium">Shift</th>
              <th className="py-2 font-medium">Backup</th>
              <th className="py-2 font-medium">Available</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="py-2 font-medium">
                  {s.name}
                  {s.isChargeNurse && <span className="ml-1.5 rounded bg-accent px-1 text-[10px]">Charge</span>}
                </td>
                <td className="py-2">{roleLabel(s.role)}</td>
                <td className="py-2 text-muted-foreground">{s.title}</td>
                <td className="py-2 text-muted-foreground">{s.shift}</td>
                <td className="py-2 text-muted-foreground">{name(s.backupId)}</td>
                <td className="py-2">{s.role !== 'manager' && <Switch checked={s.available} onCheckedChange={(v) => toggle(s, v)} aria-label={`${s.name} available`} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// -------------------------------------------------------------- automations

function Automations() {
  const { data, refresh } = usePoll(() => api<AutomationRun[]>('/automations/runs'), 4000)
  const [busy, setBusy] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | AutomationRun['automation']>('all')
  const run = async (key: string, path: string, body: unknown, ok: (r: any) => string) => {
    setBusy(key)
    try {
      const r = await api(path, { body })
      toast.success(ok(r))
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(null)
    }
  }
  const runs = (data ?? []).filter((r) => filter === 'all' || r.automation === filter)
  return (
    <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
      <div className="space-y-4">
        <section className="rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Automation 2 · SLA Watchdog</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Scheduled every 15 minutes. Finds unacknowledged tasks past SLA, reassigns to the backup (or charge nurse for clinical items), bumps
            priority and notifies the backup and you.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            <Button
              variant="outline"
              onClick={() => run('ff', '/demo/expire-sla', { count: 3 }, (r) => `Demo: ${r.expired} task(s) moved past their SLA`)}
              disabled={busy !== null}
            >
              {busy === 'ff' ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <FastForward aria-hidden />} Demo: fast-forward 3 SLAs
            </Button>
            <Button onClick={() => run('wd', '/automations/watchdog/run', {}, (r) => `Watchdog: ${r.breached} breach(es) escalated`)} disabled={busy !== null}>
              {busy === 'wd' ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Play aria-hidden />} Run watchdog now
            </Button>
            <Button variant="secondary" onClick={() => run('dr', '/automations/daily-report/run', {}, (r) => `Daily report generated (email: ${r.emailStatus})`)} disabled={busy !== null}>
              {busy === 'dr' ? <Loader2 className="animate-spin motion-reduce:animate-none" /> : <Mail aria-hidden />} Send daily report now
            </Button>
          </div>
        </section>
        <section className="rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Automation 1 · Safety Screen & Queue</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Fires on every new portal message: rule-based red-flag screen (no AI), then hand-off to the Triage & Routing Agent, task + SLA timer
            creation, assignee notification and audit log.
          </p>
        </section>
      </div>
      <section>
        <div className="mb-3 flex flex-wrap items-center gap-1">
          {(['all', 'safety_screen', 'sla_watchdog', 'daily_report'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={cn('rounded-full border px-3 py-1 text-xs', filter === f ? 'border-primary bg-accent font-medium' : 'text-muted-foreground')}
            >
              {f === 'all' ? 'All runs' : f.replace('_', ' ')}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          {runs.length === 0 && <p className="text-sm text-muted-foreground">No runs yet.</p>}
          {runs.map((r) => (
            <AutomationRunCard key={r.id} run={r} />
          ))}
        </div>
      </section>
    </div>
  )
}

// ----------------------------------------------------------------- learning

function Learning() {
  const corr = usePoll(() => api<{ id: number; messageText: string; intent: string; fromRole: string; toRole: string; reason: string | null; correctedBy: string; createdAt: string }[]>('/corrections'), 6000)
  const audit = usePoll(() => api<{ id: number; actor: string; action: string; entity: string; entityId: string | null; createdAt: string }[]>('/audit'), 6000)
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Saved corrections (labeled examples)</h2>
        <p className="mt-1 text-sm text-muted-foreground">Retrieved by similarity and used by the agent as examples. No fine-tuning needed.</p>
        <ul className="mt-3 max-h-[32rem] divide-y overflow-y-auto">
          {corr.data?.length === 0 && <li className="py-4 text-sm text-muted-foreground">No corrections yet. Reroute a card on the dashboard.</li>}
          {corr.data?.map((c) => (
            <li key={c.id} className="py-3 text-sm">
              <p className="font-medium">
                {roleLabel(c.fromRole)} → {roleLabel(c.toRole)}
              </p>
              <p className="mt-0.5 line-clamp-2 text-muted-foreground">{c.messageText}</p>
              {c.reason && <p className="mt-0.5 text-xs">Reason: {c.reason}</p>}
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                by {c.correctedBy} · {timeAgo(c.createdAt)}
              </p>
            </li>
          ))}
        </ul>
      </section>
      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Audit log</h2>
        <ul className="mt-3 max-h-[32rem] divide-y overflow-y-auto font-mono text-xs">
          {audit.data?.map((a) => (
            <li key={a.id} className="flex gap-2 py-1.5">
              <span className="w-16 shrink-0 text-muted-foreground">{timeAgo(a.createdAt)}</span>
              <span className="w-40 shrink-0 truncate">{a.actor}</span>
              <span className="flex-1">
                {a.action} {a.entity}
                {a.entityId ? `#${a.entityId}` : ''}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

// ----------------------------------------------------------------- settings

function SettingsTab() {
  const { boot, reloadBoot } = useApp()
  const [resetting, setResetting] = useState(false)
  const s = boot?.settings
  const save = async (key: keyof Settings, value: unknown) => {
    try {
      await api('/settings', { method: 'PATCH', body: { key, value } })
      toast.success('Setting saved')
      reloadBoot()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    }
  }
  const reset = async (keepCorrections: boolean) => {
    if (!confirm(keepCorrections ? 'Clear all messages and tasks but keep learned corrections?' : 'Reset ALL demo data, including learned corrections?')) return
    setResetting(true)
    try {
      await api('/admin/reset', { body: { keepCorrections } })
      toast.success('Demo data reset')
      reloadBoot()
    } finally {
      setResetting(false)
    }
  }
  if (!s || !boot) return null
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-5 rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Routing safety settings</h2>
        <NumberSetting label="Confidence threshold (below this → Triage RN review)" value={s.confidence_threshold} step={0.05} min={0.3} max={0.95} onSave={(v) => save('confidence_threshold', v)} />
        <NumberSetting label="Emergency SLA (minutes)" value={s.sla_emergency_minutes} step={5} min={5} max={60} onSave={(v) => save('sla_emergency_minutes', v)} />
        <NumberSetting label="Urgent SLA (minutes)" value={s.sla_urgent_minutes} step={15} min={15} max={240} onSave={(v) => save('sla_urgent_minutes', v)} />
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="outage">Simulate LLM outage</Label>
            <p className="text-xs text-muted-foreground">Demonstrates the fallback: every new message goes to the Triage RN queue for manual routing.</p>
          </div>
          <Switch id="outage" checked={s.simulate_llm_outage} onCheckedChange={(v) => save('simulate_llm_outage', v)} />
        </div>
        <div className="flex items-start justify-between gap-4">
          <div>
            <Label htmlFor="email-all">Email every new task</Label>
            <p className="text-xs text-muted-foreground">Off by default to stay within the Resend free tier. Emergencies, urgent items and escalations always email.</p>
          </div>
          <Switch id="email-all" checked={s.email_new_tasks} onCheckedChange={(v) => save('email_new_tasks', v)} />
        </div>
      </section>
      <section className="space-y-5 rounded-xl border bg-card p-5">
        <div>
          <h2 className="font-semibold">Emergency red-flag screen</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Deterministic and rule-based, so it runs before any AI. It is tuned to over-escalate. Changes need clinical governance review, so it is
            read-only here.
          </p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {boot.redFlagCategories.map((c) => (
              <li key={c} className="rounded-full bg-urgency-emergency/10 px-2.5 py-0.5 text-xs text-urgency-emergency">
                {c}
              </li>
            ))}
          </ul>
          <p className="mt-3 rounded-lg bg-muted p-3 text-xs">
            <span className="font-semibold">Fixed patient template:</span> {boot.emergencyTemplate}
          </p>
        </div>
        <div>
          <h2 className="font-semibold">Demo data</h2>
          <p className="mt-1 text-sm text-muted-foreground">Use before a rehearsal. Patients, staff and rules are restored from the seed.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => reset(true)} disabled={resetting}>
              <RotateCcw aria-hidden /> Clear messages, keep corrections
            </Button>
            <Button variant="destructive" onClick={() => reset(false)} disabled={resetting}>
              Reset everything
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}

function NumberSetting({ label, value, step, min, max, onSave }: { label: string; value: number; step: number; min: number; max: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value))
  const id = label.replace(/\W+/g, '-').toLowerCase()
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="mt-1.5 flex gap-2">
        <Input id={id} type="number" value={v} step={step} min={min} max={max} onChange={(e) => setV(e.target.value)} className="w-32" />
        <Button variant="outline" disabled={Number(v) === value || Number.isNaN(Number(v))} onClick={() => onSave(Math.min(max, Math.max(min, Number(v))))}>
          Save
        </Button>
      </div>
    </div>
  )
}
