import { asc, desc, sql } from 'drizzle-orm'
import { db, messages, tasks, corrections, evalRuns } from '../db'
import {
  INTENTS,
  INTENT_LABELS,
  LEGACY_ROUTE,
  ROLES,
  ROLE_LABELS,
  type PortalType,
} from '../shared/domain'

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0)

export async function computeAnalytics() {
  const msgs = await db.select({ id: messages.id, portalType: messages.portalType, isEmergency: messages.isEmergency }).from(messages)
  const allTasks = await db.select().from(tasks).orderBy(asc(tasks.id))
  const corr = await db.select({ taskId: corrections.taskId, createdAt: corrections.createdAt }).from(corrections)
  const correctedIds = new Set(corr.map((c) => c.taskId))
  const now = Date.now()
  const tasksPerMessage = new Map<number, number>()
  for (const t of allTasks) tasksPerMessage.set(t.messageId, (tasksPerMessage.get(t.messageId) ?? 0) + 1)

  const byCategory = INTENTS.map((i) => ({
    intent: i,
    label: INTENT_LABELS[i],
    count: allTasks.filter((t) => t.intent === i).length,
  }))
  const byRole = ROLES.map((r) => ({
    role: r,
    label: ROLE_LABELS[r],
    count: allTasks.filter((t) => t.assignedRole === r).length,
    open: allTasks.filter((t) => t.assignedRole === r && t.status === 'open').length,
  }))

  // Before: what legacy portal routing would have sent to a physician inbox,
  // based on the message type the patient picked. After: tasks RightRoute
  // actually assigned to physicians.
  const legacyPhysician = msgs.filter((m) => LEGACY_ROUTE[m.portalType as PortalType] === 'physician').length
  const afterPhysician = allTasks.filter((t) => t.assignedRole === 'physician').length

  const agentTasks = allTasks.filter((t) => t.routedBy === 'agent' || t.routedBy === 'reroute')
  // Reroute rate in batches of 10 routed tasks (in arrival order) — the
  // learning curve. A falling line means fewer corrections are needed.
  const batches: { label: string; ratePct: number; tasks: number }[] = []
  for (let i = 0; i < agentTasks.length; i += 10) {
    const slice = agentTasks.slice(i, i + 10)
    batches.push({
      label: `${i + 1}–${i + slice.length}`,
      tasks: slice.length,
      ratePct: pct(slice.filter((t) => correctedIds.has(t.id)).length, slice.length),
    })
  }

  const breached = allTasks.filter((t) => t.escalationCount > 0).length
  const overdueNow = allTasks.filter((t) => t.status === 'open' && !t.acknowledgedAt && new Date(t.slaDueAt).getTime() < now).length

  const evals = await db
    .select({ id: evalRuns.id, accuracy: evalRuns.accuracy, emergencyRecall: evalRuns.emergencyRecall, physicianPct: evalRuns.physicianPct, correctionsAvailable: evalRuns.correctionsAvailable, finishedAt: evalRuns.finishedAt })
    .from(evalRuns)
    .where(sql`${evalRuns.status} = 'done'`)
    .orderBy(desc(evalRuns.id))
    .limit(10)

  return {
    totals: {
      messages: msgs.length,
      tasks: allTasks.length,
      emergencies: msgs.filter((m) => m.isEmergency).length,
      fallback: allTasks.filter((t) => t.routedBy === 'fallback').length,
      needsReview: allTasks.filter((t) => t.needsReview).length,
      multiIntentMessages: [...tasksPerMessage.values()].filter((n) => n > 1).length,
    },
    byCategory,
    byRole,
    physician: {
      beforeCount: legacyPhysician,
      beforePct: pct(legacyPhysician, msgs.length),
      afterCount: afterPhysician,
      afterPct: pct(afterPhysician, allTasks.length),
    },
    reroute: {
      corrections: corr.length,
      agentTasks: agentTasks.length,
      ratePct: pct(agentTasks.filter((t) => correctedIds.has(t.id)).length, agentTasks.length),
      batches,
    },
    sla: { breached, overdueNow, breachRatePct: pct(breached, allTasks.length) },
    evals: evals.reverse(),
  }
}
