import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { CheckCircle2, FlaskConical, Loader2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { RolePill } from '@/components/badges'
import { api } from '@/lib/api'
import { usePoll } from '@/lib/use-poll'
import { pct, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/evaluate')({
  head: () => ({ meta: [{ title: 'Evaluation · RightRoute' }] }),
  component: EvaluatePage,
})

interface EvalResult {
  key: string
  subject: string
  expectedRoles: string[]
  predictedRoles: string[]
  expectEmergency: boolean
  emergencyDetected: boolean
  correct: boolean
  routedBy: string
  reasons: string[]
}

interface EvalRun {
  id: number
  status: string
  total: number
  completed: number
  accuracy: number | null
  emergencyRecall: number | null
  physicianPct: number | null
  correctionsAvailable: number
  results: EvalResult[]
  startedAt: string
  finishedAt: string | null
}

function EvaluatePage() {
  const { data, refresh } = usePoll(() => api<EvalRun[]>('/eval/runs'), 3000)
  const [starting, setStarting] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const runs = data ?? []
  const current = runs.find((r) => r.id === selected) ?? runs[0]
  const running = runs.some((r) => r.status === 'running')

  const start = async () => {
    setStarting(true)
    try {
      const r = await api<{ evalRunId: number }>('/eval/start', { body: {} })
      toast.success(`Evaluation #${r.evalRunId} started. 30 messages are going through the live pipeline.`)
      setSelected(r.evalRunId)
      refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not start')
    } finally {
      setStarting(false)
    }
  }

  const expectedPhysician = current
    ? current.results.flatMap((r) => r.expectedRoles).filter((r) => r === 'physician').length /
      Math.max(1, current.results.flatMap((r) => r.expectedRoles).length)
    : null

  return (
    <div className="mx-auto max-w-content px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Evaluation</h1>
          <p className="mt-1 max-w-reading text-muted-foreground">
            30 synthetic messages with the correct route labeled by the clinic's routing standard. Each one runs through the real safety screen and
            Triage & Routing Agent in dry-run mode, so no tasks are created.
          </p>
        </div>
        <Button size="lg" onClick={start} disabled={starting || running}>
          {starting || running ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <FlaskConical aria-hidden />}
          {running ? 'Evaluation running…' : 'Evaluate'}
        </Button>
      </div>

      {!current && data && (
        <div className="mt-10 rounded-xl border border-dashed p-10 text-center text-muted-foreground">No evaluation runs yet. Click Evaluate.</div>
      )}

      {current && (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Routing accuracy" value={pct(current.accuracy)} sub="All tasks for the message routed to the labeled roles" />
            <Metric
              label="Emergency-detection recall"
              value={pct(current.emergencyRecall)}
              sub="Must be 100% on the test set"
              tone={current.emergencyRecall == null ? undefined : current.emergencyRecall === 1 ? 'text-chart-2' : 'text-urgency-emergency'}
            />
            <Metric label="% routed to physicians" value={pct(current.physicianPct)} sub={`Labeled target: ${pct(expectedPhysician)}`} />
            <Metric label="Corrections available" value={String(current.correctionsAvailable)} sub="Past reroutes the agent could learn from" />
          </div>

          {current.status === 'running' && (
            <div className="mt-4">
              <Progress value={(current.completed / current.total) * 100} aria-label="Evaluation progress" />
              <p className="mt-1 text-xs text-muted-foreground">
                {current.completed} of {current.total} complete. Watch the agent steps on the dashboard activity panel.
              </p>
            </div>
          )}

          <section className="mt-6 overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <caption className="sr-only">Evaluation results for run {current.id}</caption>
              <thead className="border-b text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">Case</th>
                  <th className="px-4 py-2 font-medium">Message</th>
                  <th className="px-4 py-2 font-medium">Expected</th>
                  <th className="px-4 py-2 font-medium">RightRoute</th>
                  <th className="px-4 py-2 font-medium">Emergency</th>
                  <th className="px-4 py-2 font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {current.results.map((r) => (
                  <tr key={r.key} className={cn('border-t align-top', !r.correct && 'bg-urgency-urgent/5')}>
                    <td className="px-4 py-2.5 font-mono text-xs">{r.key}</td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium">{r.subject}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{r.reasons.join(' · ')}</p>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {r.expectedRoles.map((x, i) => (
                          <RolePill key={i} role={x} />
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {r.predictedRoles.map((x, i) => (
                          <RolePill key={i} role={x} />
                        ))}
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">{r.routedBy === 'safety_screen' ? 'Rule screen' : r.routedBy}</p>
                    </td>
                    <td className="px-4 py-2.5 text-xs">
                      {r.expectEmergency ? (r.emergencyDetected ? <span className="font-semibold text-chart-2">Caught</span> : <span className="font-semibold text-urgency-emergency">MISSED</span>) : r.emergencyDetected ? 'Over-escalated' : '—'}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.correct ? (
                        <CheckCircle2 className="size-5 text-chart-2" aria-label="Correct" />
                      ) : (
                        <XCircle className="size-5 text-urgency-urgent" aria-label="Incorrect" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}

      {runs.length > 1 && (
        <section className="mt-8">
          <h2 className="font-semibold">Previous runs</h2>
          <ul className="mt-2 flex flex-wrap gap-2">
            {runs.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSelected(r.id)}
                  aria-pressed={current?.id === r.id}
                  className={cn('rounded-lg border px-3 py-2 text-left text-xs', current?.id === r.id && 'border-primary bg-accent')}
                >
                  <span className="block font-semibold">
                    Run #{r.id} · {pct(r.accuracy)}
                  </span>
                  <span className="text-muted-foreground">
                    {r.status} · {timeAgo(r.startedAt)} · {r.correctionsAvailable} corrections
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn('mt-1 font-display text-3xl font-bold tabular-nums', tone)}>{value}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
    </div>
  )
}
