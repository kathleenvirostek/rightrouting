import { and, eq, gte, isNull, lt, sql } from 'drizzle-orm'
import { db, tasks, staff, automationRuns } from '../db'
import { ADMIN_INTENTS, ROLE_LABELS, type Intent, type Role } from '../shared/domain'
import {
  audit,
  finishAutomationRun,
  logAutomationStep,
  notify,
  sendEmail,
  startAutomationRun,
} from './events'
import { pickAssignee } from './clinic'
import { CHARGE_NURSE_ID, MANAGER_ID } from './seed-staff'
import { computeAnalytics } from './analytics'
import { localDateKey, localHour } from './sla'

// ---------------------------------------------------------------------------
// AUTOMATION 2 — SLA Watchdog & Daily Report
// Trigger: schedule (every 15 minutes) or the manager's "Run now" button.
// ---------------------------------------------------------------------------

export async function runSlaWatchdog(trigger: 'schedule' | 'manual') {
  const runId = await startAutomationRun('sla_watchdog', trigger)
  try {
    // Step 1: find tasks not acknowledged within their SLA.
    const now = new Date()
    const breached = await db
      .select()
      .from(tasks)
      .where(and(eq(tasks.status, 'open'), isNull(tasks.acknowledgedAt), lt(tasks.slaDueAt, now)))
    await logAutomationStep(
      runId,
      '1. Find SLA breaches',
      'ok',
      breached.length ? `${breached.length} unacknowledged task(s) past SLA: ${breached.map((t) => '#' + t.id).join(', ')}` : 'No SLA breaches found',
    )

    const staffRows = await db.select().from(staff)
    const byId = new Map(staffRows.map((s) => [s.id, s]))
    const reassigned: string[] = []
    const notified: string[] = []

    for (const t of breached) {
      // Step 2: reassign to the role's backup (or charge nurse for clinical items) and bump priority.
      const clinical = !ADMIN_INTENTS.includes(t.intent as Intent) || t.urgency === 'urgent' || t.urgency === 'emergency'
      const current = t.assignedStaffId ? byId.get(t.assignedStaffId) : undefined
      let newStaffId: string | null
      let newRole = t.assignedRole as Role
      if (clinical && t.assignedStaffId !== CHARGE_NURSE_ID && (t.assignedRole === 'triage_rn' || t.urgency === 'urgent' || t.urgency === 'emergency' || t.assignedRole === 'ma')) {
        newStaffId = CHARGE_NURSE_ID
        newRole = 'triage_rn'
      } else {
        const backup = current?.backupId ? byId.get(current.backupId) : undefined
        newStaffId = backup && backup.available && backup.role === t.assignedRole ? backup.id : await pickAssignee(newRole, null)
        if (newStaffId === t.assignedStaffId && current?.backupId) newStaffId = current.backupId
      }
      const graceMin = t.urgency === 'emergency' ? 10 : t.urgency === 'urgent' ? 30 : 60
      await db
        .update(tasks)
        .set({
          assignedStaffId: newStaffId,
          assignedRole: newRole,
          priority: sql`${tasks.priority} + 25`,
          escalationCount: sql`${tasks.escalationCount} + 1`,
          lastEscalatedAt: now,
          slaDueAt: new Date(now.getTime() + graceMin * 60_000),
        })
        .where(eq(tasks.id, t.id))
      const toName = byId.get(newStaffId ?? '')?.name ?? 'queue'
      reassigned.push(`#${t.id} ${current?.name ?? 'unassigned'} → ${toName}${clinical ? ' (clinical)' : ''}`)
      await audit('system:sla_watchdog', 'task.escalated', 'task', t.id, {
        from: t.assignedStaffId,
        to: newStaffId,
        role: newRole,
        overdueMinutes: Math.round((now.getTime() - new Date(t.slaDueAt).getTime()) / 60000),
      })

      // Step 3: notify the backup and the clinic manager.
      const body = `Task #${t.id} (${ROLE_LABELS[t.assignedRole as Role]}, ${t.urgency}) missed its SLA and was reassigned from ${current?.name ?? 'unassigned'} to ${toName}. Reason it was routed: ${t.reason}`
      if (newStaffId) {
        await notify({ staffId: newStaffId, kind: 'escalation', title: `Escalated to you: task #${t.id} missed SLA`, body, taskId: t.id, email: true })
        notified.push(toName)
      }
      await notify({ staffId: MANAGER_ID, kind: 'escalation', title: `SLA breach: task #${t.id}`, body, taskId: t.id, email: false })
    }
    await logAutomationStep(runId, '2. Reassign + bump priority', breached.length ? 'ok' : 'skipped', reassigned.join('; ') || 'Nothing to reassign')
    await logAutomationStep(
      runId,
      '3. Notify backup + manager',
      breached.length ? 'ok' : 'skipped',
      breached.length ? `Notified ${[...new Set(notified)].join(', ')} and the clinic manager` : 'Nothing to notify',
    )

    // Step 4: once daily (after 5 pm clinic time) send the manager's summary.
    let reportNote = 'Daily report already sent today or before 5 pm — skipped'
    if (trigger === 'schedule' && localHour() >= 17 && !(await reportSentToday())) {
      const r = await sendDailyReport('schedule')
      reportNote = `Daily report sent (run #${r.runId}, email ${r.emailStatus})`
    }
    await logAutomationStep(runId, '4. Daily report check', reportNote.startsWith('Daily report sent') ? 'ok' : 'skipped', reportNote)
    await finishAutomationRun(runId, 'done', breached.length ? `${breached.length} SLA breach(es) escalated` : 'All tasks within SLA')
    return { runId, breached: breached.length, reassigned }
  } catch (err) {
    await logAutomationStep(runId, 'Error', 'failed', String(err).slice(0, 300))
    await finishAutomationRun(runId, 'failed', 'Watchdog failed')
    throw err
  }
}

async function reportSentToday() {
  const start = new Date(Date.now() - 20 * 3600_000)
  const rows = await db
    .select({ id: automationRuns.id, startedAt: automationRuns.startedAt })
    .from(automationRuns)
    .where(and(eq(automationRuns.automation, 'daily_report'), eq(automationRuns.status, 'done'), gte(automationRuns.startedAt, start)))
  return rows.some((r) => localDateKey(new Date(r.startedAt)) === localDateKey())
}

export async function sendDailyReport(trigger: 'schedule' | 'manual') {
  const runId = await startAutomationRun('daily_report', trigger)
  const a = await computeAnalytics()
  await logAutomationStep(runId, 'Compute metrics', 'ok', `${a.totals.messages} messages, ${a.totals.tasks} tasks`)
  const lines = [
    `RightRoute daily summary — ${localDateKey()} (synthetic demo data)`,
    '',
    `Messages received: ${a.totals.messages} (${a.totals.emergencies} emergency screens fired)`,
    `Tasks created: ${a.totals.tasks}`,
    '',
    'Volume by category:',
    ...a.byCategory.map((c) => `  • ${c.label}: ${c.count}`),
    '',
    `Sent to physicians — before RightRoute (legacy portal routing): ${a.physician.beforePct}%`,
    `Sent to physicians — with RightRoute: ${a.physician.afterPct}%`,
    `Reroute rate (staff corrections): ${a.reroute.ratePct}% (${a.reroute.corrections} of ${a.reroute.agentTasks})`,
    `SLA breaches: ${a.sla.breached} (currently overdue: ${a.sla.overdueNow})`,
  ]
  const emailStatus = await sendEmail(`[RightRoute demo] Daily summary ${localDateKey()}`, lines.join('\n'))
  await logAutomationStep(runId, 'Email manager', emailStatus === 'sent' ? 'ok' : 'skipped', `Email: ${emailStatus}`)
  await notify({ staffId: MANAGER_ID, kind: 'daily_report', title: `Daily summary ${localDateKey()}`, body: lines.join('\n'), email: false })
  await logAutomationStep(runId, 'In-app notification + log', 'ok', 'Report saved to manager notifications')
  await finishAutomationRun(runId, 'done', lines.slice(2).filter(Boolean).join(' | '))
  return { runId, emailStatus, report: lines.join('\n') }
}
