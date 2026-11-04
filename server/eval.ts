import { eq, sql } from 'drizzle-orm'
import { db, evalRuns, corrections } from '../db'
import { EVAL_SET } from '../shared/eval-set'
import type { Role } from '../shared/domain'
import { screenForRedFlags } from './red-flags'
import { runTriageAgent } from './agents/triage'

export interface EvalResult {
  key: string
  subject: string
  expectedRoles: Role[]
  predictedRoles: Role[]
  expectEmergency: boolean
  emergencyDetected: boolean
  correct: boolean
  routedBy: string
  agentRunId: number | null
  reasons: string[]
}

export async function createEvalRun() {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(corrections)
  const [row] = await db
    .insert(evalRuns)
    .values({ total: EVAL_SET.length, correctionsAvailable: n })
    .returning({ id: evalRuns.id })
  return row.id
}

const sameMultiset = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join()

// Runs every labeled case through the same safety screen + Triage & Routing
// Agent used in production, in dry-run mode (no tasks are created).
export async function runEvaluation(evalRunId: number, concurrency = 5) {
  const results: EvalResult[] = []
  const queue = [...EVAL_SET]
  const worker = async () => {
    while (queue.length) {
      const c = queue.shift()!
      const hits = screenForRedFlags(`${c.subject}\n${c.body}`)
      let r: EvalResult
      if (hits.length) {
        r = {
          key: c.key,
          subject: c.subject,
          expectedRoles: c.expectedRoles,
          predictedRoles: ['triage_rn'],
          expectEmergency: c.expectEmergency,
          emergencyDetected: true,
          correct: sameMultiset(['triage_rn'], c.expectedRoles),
          routedBy: 'safety_screen',
          agentRunId: null,
          reasons: [`Red-flag screen: ${hits.map((h) => h.category).join(', ')}`],
        }
      } else {
        const out = await runTriageAgent({
          messageId: null,
          evalRunId,
          patientId: c.patientId,
          portalType: c.portalType,
          subject: c.subject,
          body: c.body,
        })
        const predicted = out.decisions.map((d) => d.role)
        r = {
          key: c.key,
          subject: c.subject,
          expectedRoles: c.expectedRoles,
          predictedRoles: predicted,
          expectEmergency: c.expectEmergency,
          emergencyDetected: out.decisions.some((d) => d.urgency === 'emergency'),
          correct: sameMultiset(predicted, c.expectedRoles),
          routedBy: out.routedBy,
          agentRunId: out.runId,
          reasons: out.decisions.map((d) => d.reason),
        }
      }
      results.push(r)
      await db
        .update(evalRuns)
        .set({ completed: results.length, results: [...results].sort((a, b) => a.key.localeCompare(b.key)) })
        .where(eq(evalRuns.id, evalRunId))
    }
  }
  try {
    await Promise.all(Array.from({ length: concurrency }, worker))
    const emergencies = results.filter((r) => r.expectEmergency)
    const predictedTotal = results.reduce((s, r) => s + r.predictedRoles.length, 0)
    const physician = results.reduce((s, r) => s + r.predictedRoles.filter((x) => x === 'physician').length, 0)
    await db
      .update(evalRuns)
      .set({
        status: 'done',
        accuracy: results.filter((r) => r.correct).length / results.length,
        emergencyRecall: emergencies.length ? emergencies.filter((r) => r.emergencyDetected).length / emergencies.length : 1,
        physicianPct: predictedTotal ? physician / predictedTotal : 0,
        finishedAt: new Date(),
      })
      .where(eq(evalRuns.id, evalRunId))
  } catch (err) {
    await db.update(evalRuns).set({ status: 'failed', finishedAt: new Date() }).where(eq(evalRuns.id, evalRunId))
    throw err
  }
}
