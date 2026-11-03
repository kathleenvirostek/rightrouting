import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardCopy, Lock, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { AutomationRunCard, StepRow } from '@/components/agent-activity'
import { ConfidenceMeter, RolePill, SlaTimer, UrgencyBadge } from '@/components/badges'
import { RerouteDialog } from '@/components/task-card'
import { api } from '@/lib/api'
import { usePoll } from '@/lib/use-poll'
import { useApp } from '@/lib/app-context'
import { intentLabel, roleLabel, timeAgo } from '@/lib/format'
import type { AgentStep, AutomationRun, Task } from '@/lib/types'
import { PORTAL_TYPE_LABELS, type PortalType } from '@shared/domain'

export const Route = createFileRoute('/messages/$messageId')({
  head: ({ params }) => ({ meta: [{ title: `Message #${params.messageId} · RightRoute` }] }),
  component: MessageDetail,
})

interface Detail {
  message: {
    id: number
    patientId: string
    portalType: string
    subject: string
    body: string
    status: string
    isEmergency: boolean
    redFlags: string[]
    patientAutoReply: string | null
    createdAt: string
  }
  patient: {
    id: string
    name: string
    age: number
    sex: string
    mrn: string
    pcp: string | null
    podMa: string | null
    nextAppointment: string | null
    insurance: { plan: string; balanceDue: number }
    clinical: null | {
      problems: string[]
      allergies: string[]
      medications: string[]
      lastVisit: { date: string; type: string; summary: string } | null
      abnormalLabs: string[]
      openOrders: string[]
    }
  }
  tasks: Task[]
  agentRuns: { id: number; agent: string; status: string; model: string; stepCount: number; inputTokens: number; outputTokens: number; taskId: number | null; startedAt: string; finishedAt: string | null; error: string | null; steps: AgentStep[] }[]
  automationRuns: AutomationRun[]
  corrections: { id: number; taskId: number; fromRole: string; toRole: string; reason: string | null }[]
}

function MessageDetail() {
  const { messageId } = Route.useParams()
  const { persona } = useApp()
  const { data, error, refresh } = usePoll(() => api<Detail>(`/messages/${messageId}`), 3000, [messageId, persona?.id])

  if (error) return <div className="mx-auto max-w-content px-4 py-10 text-destructive sm:px-6">Could not load message: {error}</div>
  if (!data)
    return (
      <div className="mx-auto max-w-content space-y-4 px-4 py-10 sm:px-6">
        <div className="h-8 w-1/3 animate-pulse rounded bg-muted motion-reduce:animate-none" />
        <div className="h-40 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      </div>
    )

  const { message: m, patient: p } = data
  return (
    <div className="mx-auto max-w-content px-4 py-8 sm:px-6">
      <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Back to dashboard
      </Link>
      <h1 className="mt-3 font-display text-3xl font-bold tracking-tight">
        Message #{m.id}: {m.subject}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        From {p.name} · {timeAgo(m.createdAt)} · patient chose “{PORTAL_TYPE_LABELS[m.portalType as PortalType]}”
      </p>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-xl border bg-card p-5" aria-labelledby="orig">
            <h2 id="orig" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Original message
            </h2>
            <p className="mt-2 whitespace-pre-line leading-relaxed">{m.body}</p>
            {m.isEmergency && (
              <div className="mt-4 rounded-lg border border-urgency-emergency/40 bg-urgency-emergency/5 p-3">
                <p className="flex items-center gap-1.5 text-sm font-semibold text-urgency-emergency">
                  <AlertTriangle className="size-4" aria-hidden /> Emergency screen fired: {m.redFlags.join(', ')}
                </p>
                <p className="mt-1 text-sm">
                  <span className="font-medium">Fixed auto-reply sent to patient:</span> {m.patientAutoReply}
                </p>
              </div>
            )}
          </section>

          {data.tasks.length === 0 && (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              {m.status === 'routing' ? 'The Triage & Routing Agent is deciding where this goes. Watch the trace below…' : 'No tasks yet.'}
            </div>
          )}
          {data.tasks.map((t) => (
            <TaskPanel key={t.id} task={t} onChange={refresh} corrected={data.corrections.find((c) => c.taskId === t.id)} />
          ))}

          <section aria-labelledby="trace" className="rounded-xl border bg-card p-5">
            <h2 id="trace" className="font-semibold">
              Agent and automation trace
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">Every step the agents and automations took for this message, in order.</p>
            <div className="mt-4 space-y-3">
              {data.automationRuns.map((a) => (
                <AutomationRunCard key={a.id} run={a} />
              ))}
            </div>
            {data.agentRuns.map((r) => (
              <div key={r.id} className="mt-5">
                <div className="flex flex-wrap items-center gap-2 border-b pb-2">
                  <h3 className="text-sm font-semibold">{r.agent === 'triage' ? 'Triage & Routing Agent' : `Care Team Prep Agent (task #${r.taskId})`}</h3>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                    run #{r.id} · {r.model} · {r.stepCount} steps · {r.inputTokens + r.outputTokens} tokens · {r.status}
                  </span>
                </div>
                <ul className="mt-3 space-y-3">
                  {r.steps.map((s) => (
                    <StepRow key={s.id} step={s} showMeta={false} />
                  ))}
                </ul>
              </div>
            ))}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="rounded-xl border bg-card p-5" aria-labelledby="ctx">
            <h2 id="ctx" className="font-semibold">
              Patient context
            </h2>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Patient</dt>
              <dd>
                {p.name}, {p.age}
                {p.sex}
              </dd>
              <dt className="text-muted-foreground">MRN</dt>
              <dd>{p.mrn} (synthetic)</dd>
              <dt className="text-muted-foreground">PCP</dt>
              <dd>{p.pcp}</dd>
              <dt className="text-muted-foreground">Pod MA</dt>
              <dd>{p.podMa}</dd>
              <dt className="text-muted-foreground">Next appt</dt>
              <dd>{p.nextAppointment ?? 'None scheduled'}</dd>
              <dt className="text-muted-foreground">Insurance</dt>
              <dd>
                {p.insurance.plan}
                {p.insurance.balanceDue > 0 && ` · $${p.insurance.balanceDue.toFixed(2)} due`}
              </dd>
            </dl>
            {p.clinical ? (
              <div className="mt-4 space-y-3 text-sm">
                <ContextList title="Problems" items={p.clinical.problems} />
                <ContextList title="Medications" items={p.clinical.medications} />
                <ContextList title="Allergies" items={p.clinical.allergies} />
                <ContextList title="Abnormal labs" items={p.clinical.abnormalLabs} />
                <ContextList title="Open orders" items={p.clinical.openOrders} />
                {p.clinical.lastVisit && (
                  <p>
                    <span className="font-medium">Last visit:</span> {p.clinical.lastVisit.date} · {p.clinical.lastVisit.type}
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-4 flex gap-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                Clinical details are hidden for {roleLabel(persona?.role ?? '')} (minimum-necessary access).
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}

function ContextList({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null
  return (
    <div>
      <p className="font-medium">{title}</p>
      <ul className="mt-0.5 list-disc pl-5 text-muted-foreground">
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
    </div>
  )
}

function TaskPanel({ task, onChange, corrected }: { task: Task; onChange: () => void; corrected?: { fromRole: string; toRole: string; reason: string | null } }) {
  const [reroute, setReroute] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const b = task.prepBrief
  const reply = draft ?? b?.suggestedReply ?? ''

  const accept = async () => {
    try {
      await api(`/tasks/${task.id}/accept`, { method: 'POST', body: {} })
      toast.success('Accepted')
      onChange()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed')
    }
  }

  return (
    <section className="rounded-xl border bg-card p-5" aria-labelledby={`tp-${task.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 id={`tp-${task.id}`} className="font-semibold">
          Task #{task.id} · {intentLabel(task.intent)}
        </h2>
        <UrgencyBadge urgency={task.urgency} />
        <RolePill role={task.assignedRole} />
        <span className="text-sm text-muted-foreground">{task.assignedName}</span>
        <span className="ml-auto">
          <SlaTimer dueAt={task.slaDueAt} done={task.status === 'accepted'} />
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <ConfidenceMeter value={task.confidence} />
        <span className="text-muted-foreground">{task.reason}</span>
      </div>
      {task.excerpt && <p className="mt-2 border-l-2 pl-3 text-sm italic text-muted-foreground">“{task.excerpt}”</p>}
      {corrected && (
        <p className="mt-2 text-xs text-chart-3">
          Correction saved: {roleLabel(corrected.fromRole)} → {roleLabel(corrected.toRole)}
          {corrected.reason && ` (${corrected.reason})`}
        </p>
      )}

      <div className="mt-4 rounded-lg border bg-background p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">Prep brief for {roleLabel(task.assignedRole)}</h3>
          {b && (
            <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-secondary-foreground">
              {b.mode === 'reply' ? 'Suggested reply for staff to edit' : 'Clinician summary (no patient reply)'}
            </span>
          )}
        </div>
        {(task.prepStatus === 'pending' || task.prepStatus === 'running') && (
          <p className="mt-2 animate-pulse text-sm text-muted-foreground motion-reduce:animate-none">Care Team Prep Agent is gathering chart context…</p>
        )}
        {task.prepStatus === 'failed' && <p className="mt-2 text-sm text-muted-foreground">Prep brief unavailable. Work from the original message.</p>}
        {b && (
          <div className="mt-3 space-y-3 text-sm">
            <ul className="list-disc space-y-1 pl-5">
              {b.brief.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ul>
            {b.protocolFlags.length > 0 && (
              <div>
                <p className="font-medium">Refill protocol</p>
                <ul className="mt-1 space-y-1">
                  {b.protocolFlags.map((f) => (
                    <li key={f} className="flex gap-1.5 text-muted-foreground">
                      <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden /> {f}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {b.keyQuestions.length > 0 && (
              <div>
                <p className="font-medium">Key questions for the clinician</p>
                <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
                  {b.keyQuestions.map((q, i) => (
                    <li key={i}>{q}</li>
                  ))}
                </ol>
              </div>
            )}
            {b.mode === 'reply' && !b.suggestedReply && (
              <div className="rounded-md border border-urgency-urgent/40 bg-urgency-urgent/5 p-3 text-sm">
                <p className="font-medium">No suggested reply. Staff should write this one.</p>
                <p className="mt-0.5 text-muted-foreground">
                  {b.replyNote || 'No draft passed the self-check, so none was attached.'}
                </p>
              </div>
            )}
            {b.mode === 'reply' && b.suggestedReply && (
              <div>
                <label htmlFor={`draft-${task.id}`} className="font-medium">
                  Suggested reply (edit before sending, never sent automatically)
                </label>
                <Textarea id={`draft-${task.id}`} className="mt-1" rows={5} value={reply} onChange={(e) => setDraft(e.target.value)} />
                <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>Reading grade {b.readingGrade ?? '—'}</span>
                  <span>{b.wordCount ?? '—'} words</span>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(reply)
                      toast.success('Copied draft')
                    }}
                  >
                    <ClipboardCopy aria-hidden /> Copy
                  </Button>
                </div>
              </div>
            )}
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className={`size-3.5 ${b.selfCheck.passed ? 'text-chart-2' : 'text-urgency-urgent'}`} aria-hidden />
              Self-check {b.selfCheck.passed ? 'passed' : 'flagged issues'} after {b.selfCheck.attempts} check(s): no diagnosis or treatment advice, facts
              verified against chart, reading level and length. Chart sections used: {b.sectionsUsed.join(', ') || 'none'}.
            </p>
          </div>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <Button size="sm" onClick={accept} disabled={task.status === 'accepted'}>
          {task.status === 'accepted' ? 'Accepted' : 'Accept'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setReroute(true)} disabled={task.status === 'accepted'}>
          Reroute
        </Button>
      </div>
      <RerouteDialog task={task} open={reroute} onOpenChange={setReroute} onDone={onChange} />
    </section>
  )
}
