import { and, desc, eq, inArray } from 'drizzle-orm'
import { db, messages, tasks, staff, automationRuns } from '../db'
import {
  INTENT_LABELS,
  ROLE_LABELS,
  URGENCY_LABELS,
  type PortalType,
  type RoutedTaskDecision,
} from '../shared/domain'
import { screenForRedFlags, EMERGENCY_TEMPLATE } from './red-flags'
import {
  audit,
  finishAutomationRun,
  logAutomationStep,
  notify,
  startAutomationRun,
} from './events'
import { pickAssignee } from './clinic'
import { computeSlaDue, slaClass, SLA_CLASS_LABELS } from './sla'
import { getSettings } from './settings'
import { runTriageAgent } from './agents/triage'
import { runPrepAgent } from './agents/prep'

export interface NewMessage {
  patientId: string
  portalType: PortalType
  subject: string
  body: string
  source?: 'portal' | 'sample'
}

// ---------------------------------------------------------------------------
// AUTOMATION 1 — Safety Screen & Queue Pipeline
// Trigger: event (new portal message received).
// Step 1 runs synchronously with NO AI so emergencies are handled instantly.
// Steps 2–4 run in a background function (agents can take ~20–60 s).
// ---------------------------------------------------------------------------

export async function receiveMessage(m: NewMessage) {
  const [msg] = await db
    .insert(messages)
    .values({ ...m, source: m.source ?? 'portal', status: 'received' })
    .returning()
  const runId = await startAutomationRun('safety_screen', 'event', msg.id)
  await logAutomationStep(runId, 'Trigger', 'ok', `New portal message #${msg.id} received from patient ${m.patientId}`)
  await audit('patient:' + m.patientId, 'message.received', 'message', msg.id, { subject: m.subject })

  // Step 1: deterministic red-flag screen, before any AI.
  const hits = screenForRedFlags(`${m.subject}\n${m.body}`)
  if (hits.length) {
    await handleEmergency(msg.id, m, hits, runId)
    return { messageId: msg.id, emergency: true, redFlags: hits, needsAgent: false }
  }
  await logAutomationStep(runId, '1. Red-flag screen', 'ok', 'No red-flag keywords/patterns matched — passing to Triage & Routing Agent')
  await db.update(messages).set({ status: 'routing' }).where(eq(messages.id, msg.id))
  return { messageId: msg.id, emergency: false, redFlags: [], needsAgent: true }
}

async function handleEmergency(
  messageId: number,
  m: NewMessage,
  hits: { category: string; match: string }[],
  runId: number,
) {
  const s = await getSettings()
  const categories = [...new Set(hits.map((h) => h.category))]
  await logAutomationStep(
    runId,
    '1. Red-flag screen',
    'fired',
    `EMERGENCY: matched ${hits.map((h) => `"${h.match}" (${h.category})`).join(', ')}. No AI used.`,
  )
  await db
    .update(messages)
    .set({ status: 'emergency', isEmergency: true, redFlags: categories, patientAutoReply: EMERGENCY_TEMPLATE })
    .where(eq(messages.id, messageId))
  await logAutomationStep(runId, '1a. Patient auto-reply', 'ok', 'Sent fixed, pre-approved 911/ER template (not AI-generated)')
  await audit('system:safety_screen', 'patient.emergency_template_sent', 'message', messageId, { categories })

  const rn = await pickAssignee('triage_rn', m.patientId)
  const [task] = await db
    .insert(tasks)
    .values({
      messageId,
      intent: 'symptom',
      urgency: 'emergency',
      assignedRole: 'triage_rn',
      assignedStaffId: rn,
      originalRole: 'triage_rn',
      reason: `Red-flag screen matched: ${categories.join(', ')}. Patient was told to call 911/go to the ER. Call the patient now to confirm they are getting emergency care.`,
      confidence: 1,
      excerpt: m.body.slice(0, 600),
      routedBy: 'safety_screen',
      priority: 100,
      slaDueAt: computeSlaDue('symptom', 'emergency', s),
    })
    .returning()
  await logAutomationStep(runId, '3. Create task + SLA', 'ok', `Task #${task.id} in Triage RN queue, SLA ${s.sla_emergency_minutes} min`)

  const [rnRow] = rn ? await db.select().from(staff).where(eq(staff.id, rn)) : []
  const n = await notify({
    staffId: rn ?? 'S05',
    kind: 'emergency',
    title: `EMERGENCY portal message — ${categories.join(', ')}`,
    body: `Patient ${m.patientId}: "${m.body.slice(0, 200)}". Call the patient now. Task #${task.id}.`,
    taskId: task.id,
    email: true,
  })
  await logAutomationStep(
    runId,
    '4. Alert on-duty Triage RN',
    'ok',
    `Alerted ${rnRow?.name ?? 'Triage RN'} (in-app${n.emailStatus === 'sent' ? ' + email' : ''}; email: ${n.emailStatus})`,
  )
  await audit('system:safety_screen', 'task.created', 'task', task.id, { role: 'triage_rn', urgency: 'emergency' })
  await finishAutomationRun(runId, 'done', `Emergency screen fired (${categories.join(', ')}) — RN alerted, no AI used`)
}

// Steps 2–4 for a non-emergency message. Runs inside the background function.
export async function routeMessage(messageId: number) {
  const [msg] = await db.select().from(messages).where(eq(messages.id, messageId))
  if (!msg || msg.status !== 'routing') return
  const [run] = await db
    .select()
    .from(automationRuns)
    .where(and(eq(automationRuns.messageId, messageId), eq(automationRuns.automation, 'safety_screen')))
    .orderBy(desc(automationRuns.id))
    .limit(1)
  const runId = run?.id ?? (await startAutomationRun('safety_screen', 'event', messageId))
  const s = await getSettings()

  try {
    // Step 2: hand off to the Triage & Routing Agent.
    await logAutomationStep(runId, '2. Triage & Routing Agent', 'ok', 'Agent started')
    const result = await runTriageAgent({
      messageId,
      patientId: msg.patientId,
      portalType: msg.portalType,
      subject: msg.subject,
      body: msg.body,
    })
    await logAutomationStep(
      runId,
      '2. Triage & Routing Agent',
      result.routedBy === 'fallback' ? 'failed' : 'ok',
      result.routedBy === 'fallback'
        ? 'AI unavailable — fallback routed message to Triage RN queue'
        : `Agent returned ${result.decisions.length} task(s) (agent run #${result.runId})`,
    )

    // Step 3: create tasks in queues with SLA timers.
    const created = await createTasks(messageId, result.decisions, result.routedBy, s)
    await logAutomationStep(
      runId,
      '3. Create tasks + SLA timers',
      'ok',
      created
        .map((t) => `#${t.id} → ${ROLE_LABELS[t.assignedRole as keyof typeof ROLE_LABELS]} (${SLA_CLASS_LABELS[slaClass(t.intent as any, t.urgency as any)]})`)
        .join('; '),
    )
    await db.update(messages).set({ status: 'routed' }).where(eq(messages.id, messageId))

    // Step 4: notify each assignee + audit log.
    const notes: string[] = []
    for (const t of created) {
      if (!t.assignedStaffId) continue
      const n = await notify({
        staffId: t.assignedStaffId,
        kind: 'new_task',
        title: `New ${INTENT_LABELS[t.intent as keyof typeof INTENT_LABELS]} task (${URGENCY_LABELS[t.urgency as keyof typeof URGENCY_LABELS]})`,
        body: t.reason,
        taskId: t.id,
        email: s.email_new_tasks || t.urgency === 'urgent',
      })
      notes.push(`${t.assignedStaffId}${n.emailStatus ? ` (email ${n.emailStatus})` : ''}`)
      await audit('system:pipeline', 'task.created', 'task', t.id, {
        role: t.assignedRole,
        staff: t.assignedStaffId,
        routedBy: t.routedBy,
        confidence: t.confidence,
      })
    }
    await logAutomationStep(runId, '4. Notify assignee + audit', 'ok', `Notified ${notes.join(', ')}; audit entries written`)
    await finishAutomationRun(runId, 'done', `Routed to ${created.map((t) => t.assignedRole).join(' + ')}`)
    return created.map((t) => t.id)
  } catch (err) {
    await logAutomationStep(runId, 'Pipeline error', 'failed', String(err).slice(0, 300))
    await finishAutomationRun(runId, 'failed', 'Pipeline failed')
    await db.update(messages).set({ status: 'failed' }).where(eq(messages.id, messageId))
    throw err
  }
}

async function createTasks(
  messageId: number,
  decisions: RoutedTaskDecision[],
  routedBy: 'agent' | 'fallback',
  s: Awaited<ReturnType<typeof getSettings>>,
) {
  const priority = { emergency: 100, urgent: 50, same_day: 20, routine: 0 }
  return db
    .insert(tasks)
    .values(
      decisions.map((d) => ({
        messageId,
        intent: d.intent,
        urgency: d.urgency,
        assignedRole: d.role,
        assignedStaffId: d.staffId,
        originalRole: d.role,
        reason: d.reason,
        confidence: d.confidence,
        excerpt: d.excerpt,
        routedBy,
        needsReview: d.needsReview,
        reviewNote: d.reviewNote,
        priority: priority[d.urgency],
        slaDueAt: computeSlaDue(d.intent, d.urgency, s),
      })),
    )
    .returning()
}

// Full background job for a batch of messages: route, then prep each task.
export async function processMessages(messageIds: number[], concurrency = 4) {
  const queue = [...messageIds]
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift()!
      try {
        const [msg] = await db.select().from(messages).where(eq(messages.id, id))
        let taskIds: number[] = []
        if (msg?.status === 'routing') taskIds = (await routeMessage(id)) ?? []
        else if (msg?.status === 'emergency') {
          const t = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.messageId, id), eq(tasks.prepStatus, 'pending')))
          taskIds = t.map((x) => x.id)
        }
        for (const tid of taskIds) await runPrepAgent(tid)
      } catch (err) {
        console.error('processMessages failed for', id, err)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, messageIds.length) }, worker))
}

export async function prepTasks(taskIds: number[]) {
  const rows = await db.select().from(tasks).where(inArray(tasks.id, taskIds))
  for (const t of rows) await runPrepAgent(t.id)
}
