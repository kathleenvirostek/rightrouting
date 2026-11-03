import type { Config, Context } from '@netlify/functions'
import { and, asc, desc, eq, gt, inArray, isNull, sql } from 'drizzle-orm'
import {
  db,
  patients,
  staff,
  messages,
  tasks,
  corrections,
  routingRules,
  agentRuns,
  agentSteps,
  automationRuns,
  notifications,
  auditLog,
  evalRuns,
} from '../../db'
import { ensureSeeded, resetDemo } from '../../server/seed'
import { getSettings, updateSetting, type ClinicSettings } from '../../server/settings'
import { receiveMessage } from '../../server/pipeline'
import { runSlaWatchdog, sendDailyReport } from '../../server/watchdog'
import { computeAnalytics } from '../../server/analytics'
import { createEvalRun } from '../../server/eval'
import { audit, notify } from '../../server/events'
import { ageFromDob, pickAssignee } from '../../server/clinic'
import { RED_FLAG_RULES, EMERGENCY_TEMPLATE } from '../../server/red-flags'
import { getInternalToken } from '../../server/internal'
import { SAMPLE_MESSAGES } from '../../db/seed-messages'
import { EVAL_SET } from '../../shared/eval-set'
import {
  CLINICAL_ROLES,
  PORTAL_TYPES,
  ROLES,
  ROLE_LABELS,
  type PortalType,
  type Role,
} from '../../shared/domain'

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

type Handler = (args: { req: Request; params: Record<string, string>; url: URL; viewer: Viewer; ctx: Context }) => Promise<unknown>
interface Viewer {
  id: string
  role: string
  name: string
}

const routes: { method: string; segments: string[]; handler: Handler }[] = []
const route = (method: string, path: string, handler: Handler) =>
  routes.push({ method, segments: `/api${path}`.split('/').filter(Boolean), handler })

function matchPath(segments: string[], pathname: string): Record<string, string> | null {
  const parts = pathname.split('/').filter(Boolean)
  if (parts.length !== segments.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].startsWith(':')) params[segments[i].slice(1)] = decodeURIComponent(parts[i])
    else if (segments[i] !== parts[i]) return null
  }
  return params
}

async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T
  } catch {
    throw new HttpError(400, 'Invalid JSON body')
  }
}

function requireManager(viewer: Viewer) {
  if (viewer.role !== 'manager') throw new HttpError(403, 'Manager view only — switch to the manager in the demo role switcher')
}

// Hands message processing to the background function (agents can run for
// up to a minute per message; background functions allow 15 minutes).
// The visitor's cookies are forwarded so the call also passes Netlify site
// protection (team-only visibility or password) when it is turned on.
async function triggerBackground(req: Request, fn: string, payload: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-internal-token': await getInternalToken() }
  const cookie = req.headers.get('cookie')
  if (cookie) headers.cookie = cookie
  const res = await fetch(`${new URL(req.url).origin}/.netlify/functions/${fn}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
  if (!res.ok && res.status !== 202) console.error(`Background trigger ${fn} failed: ${res.status}`)
}

// ---------------------------------------------------------------- bootstrap

route('GET', '/health', async () => {
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(staff)
  return {
    database: 'ok',
    staff: n,
    aiGateway: Boolean(Netlify.env.get('ANTHROPIC_API_KEY') || Netlify.env.get('ANTHROPIC_BASE_URL')),
    email: Boolean(Netlify.env.get('RESEND_API_KEY') && Netlify.env.get('NOTIFY_EMAIL_TO')),
  }
})

route('GET', '/bootstrap', async () => {
  const [pts, st, s] = await Promise.all([db.select().from(patients).orderBy(asc(patients.id)), db.select().from(staff).orderBy(asc(staff.id)), getSettings()])
  const staffName = new Map(st.map((x) => [x.id, x.name]))
  return {
    patients: pts.map((p) => ({ id: p.id, name: p.name, age: ageFromDob(p.dob), sex: p.sex, mrn: p.mrn, pcp: staffName.get(p.pcpId) })),
    staff: st,
    samples: SAMPLE_MESSAGES,
    settings: s,
    redFlagCategories: RED_FLAG_RULES.map((r) => r.category),
    emergencyTemplate: EMERGENCY_TEMPLATE,
    evalSetSize: EVAL_SET.length,
  }
})

// ------------------------------------------------------------------ messages

route('POST', '/messages', async ({ req }) => {
  const b = await body<{ patientId: string; portalType: PortalType; subject: string; body: string }>(req)
  if (!b.patientId || !b.body?.trim()) throw new HttpError(400, 'patientId and body are required')
  if (!PORTAL_TYPES.includes(b.portalType)) throw new HttpError(400, 'Invalid portal type')
  if (b.body.length > 4000) throw new HttpError(400, 'Message is too long (4000 characters max)')
  const result = await receiveMessage({
    patientId: b.patientId,
    portalType: b.portalType,
    subject: (b.subject || 'Portal message').slice(0, 140),
    body: b.body.trim(),
  })
  await triggerBackground(req, 'process-messages', { messageIds: [result.messageId] })
  return result
})

route('GET', '/messages', async () => {
  const rows = await db.select().from(messages).orderBy(desc(messages.id)).limit(40)
  const ids = rows.map((r) => r.id)
  const t = ids.length ? await db.select().from(tasks).where(inArray(tasks.messageId, ids)) : []
  const pts = await db.select({ id: patients.id, name: patients.name }).from(patients)
  const pname = new Map(pts.map((p) => [p.id, p.name]))
  const st = await db.select({ id: staff.id, name: staff.name }).from(staff)
  const sname = new Map(st.map((s) => [s.id, s.name]))
  return rows.map((m) => ({
    ...m,
    patientName: pname.get(m.patientId),
    tasks: t
      .filter((x) => x.messageId === m.id)
      .map((x) => ({
        id: x.id,
        role: x.assignedRole,
        intent: x.intent,
        urgency: x.urgency,
        assignedName: x.assignedStaffId ? (sname.get(x.assignedStaffId) ?? null) : null,
      })),
  }))
})

route('GET', '/messages/:id', async ({ params, viewer }) => {
  const id = Number(params.id)
  const [m] = await db.select().from(messages).where(eq(messages.id, id))
  if (!m) throw new HttpError(404, 'Message not found')
  const [p] = await db.select().from(patients).where(eq(patients.id, m.patientId))
  const st = await db.select().from(staff)
  const name = (sid: string | null) => st.find((x) => x.id === sid)?.name ?? null
  const t = await db.select().from(tasks).where(eq(tasks.messageId, id)).orderBy(asc(tasks.id))
  const runs = await db.select().from(agentRuns).where(eq(agentRuns.messageId, id)).orderBy(asc(agentRuns.id))
  const steps = runs.length ? await db.select().from(agentSteps).where(inArray(agentSteps.runId, runs.map((r) => r.id))).orderBy(asc(agentSteps.id)) : []
  const autos = await db.select().from(automationRuns).where(eq(automationRuns.messageId, id)).orderBy(asc(automationRuns.id))
  const corr = t.length ? await db.select().from(corrections).where(inArray(corrections.taskId, t.map((x) => x.id))) : []
  const clinicalViewer = viewer.role === 'manager' || CLINICAL_ROLES.includes(viewer.role as Role)
  const c = p.chart
  return {
    message: m,
    patient: {
      id: p.id,
      name: p.name,
      age: ageFromDob(p.dob),
      sex: p.sex,
      mrn: p.mrn,
      pcp: name(p.pcpId),
      podMa: name(p.maId),
      nextAppointment: c.nextAppointment,
      insurance: { plan: c.insurance.plan, balanceDue: c.insurance.balanceDue },
      clinical: clinicalViewer
        ? {
            problems: c.problems,
            allergies: c.allergies,
            medications: c.medications.map((x) => `${x.name} ${x.dose}${x.controlled ? ' (controlled)' : ''}`),
            lastVisit: c.visits[0] ?? null,
            abnormalLabs: c.labs.filter((l) => l.flag !== 'normal').map((l) => `${l.name}: ${l.result} (${l.flag})`),
            openOrders: c.orders.filter((o) => o.status !== 'completed').map((o) => o.description),
          }
        : null,
    },
    tasks: t.map((x) => ({ ...x, assignedName: name(x.assignedStaffId) })),
    agentRuns: runs.map((r) => ({ ...r, steps: steps.filter((s) => s.runId === r.id) })),
    automationRuns: autos,
    corrections: corr,
  }
})

// --------------------------------------------------------------------- demo

route('POST', '/demo/load-samples', async ({ req }) => {
  const b = await body<{ count?: number }>(req).catch(() => ({ count: 25 }))
  const count = Math.min(Math.max(b.count ?? 25, 1), 50)
  // Use the demo messages first, then a shuffled mix so every category appears.
  const pinned = SAMPLE_MESSAGES.filter((m) => ['m01', 'm02', 'm03', 'm04'].includes(m.key))
  const rest = SAMPLE_MESSAGES.filter((m) => !pinned.includes(m)).sort(() => Math.random() - 0.5)
  const chosen = [...pinned, ...rest].slice(0, count)
  const results = []
  for (const s of chosen) {
    results.push(await receiveMessage({ patientId: s.patientId, portalType: s.portalType, subject: s.subject, body: s.body, source: 'sample' }))
  }
  const ids = results.map((r) => r.messageId)
  await triggerBackground(req, 'process-messages', { messageIds: ids })
  return { loaded: results.length, emergencies: results.filter((r) => r.emergency).length, messageIds: ids }
})

route('POST', '/demo/expire-sla', async ({ req, viewer }) => {
  const b = await body<{ count?: number }>(req).catch(() => ({ count: 3 }))
  const open = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.status, 'open'), isNull(tasks.acknowledgedAt)))
    .orderBy(asc(tasks.id))
    .limit(Math.min(b.count ?? 3, 10))
  if (!open.length) return { expired: 0 }
  await db
    .update(tasks)
    .set({ slaDueAt: new Date(Date.now() - 60_000) })
    .where(inArray(tasks.id, open.map((o) => o.id)))
  await audit(viewer.id, 'demo.fast_forward_sla', 'task', null, { taskIds: open.map((o) => o.id) })
  return { expired: open.length, taskIds: open.map((o) => o.id) }
})

// -------------------------------------------------------------------- tasks

route('GET', '/tasks', async () => {
  const rows = await db
    .select({ task: tasks, message: messages, patientName: patients.name, assignedName: staff.name })
    .from(tasks)
    .innerJoin(messages, eq(messages.id, tasks.messageId))
    .innerJoin(patients, eq(patients.id, messages.patientId))
    .leftJoin(staff, eq(staff.id, tasks.assignedStaffId))
    .orderBy(desc(tasks.priority), asc(tasks.slaDueAt))
    .limit(300)
  const counts = await db.select({ messageId: tasks.messageId, n: sql<number>`count(*)::int` }).from(tasks).groupBy(tasks.messageId)
  const siblings = new Map(counts.map((c) => [c.messageId, c.n]))
  return rows.map((r) => ({
    ...r.task,
    assignedName: r.assignedName,
    patientName: r.patientName,
    patientId: r.message.patientId,
    subject: r.message.subject,
    body: r.message.body,
    isEmergency: r.message.isEmergency,
    splitFrom: (siblings.get(r.task.messageId) ?? 1) > 1 ? siblings.get(r.task.messageId) : null,
  }))
})

route('POST', '/tasks/:id/accept', async ({ params, viewer }) => {
  const id = Number(params.id)
  const [t] = await db
    .update(tasks)
    .set({ status: 'accepted', acknowledgedAt: new Date(), acknowledgedBy: viewer.id })
    .where(eq(tasks.id, id))
    .returning()
  if (!t) throw new HttpError(404, 'Task not found')
  await audit(viewer.id, 'task.accepted', 'task', id, { role: t.assignedRole })
  return t
})

route('POST', '/tasks/:id/reroute', async ({ params, req, viewer }) => {
  const id = Number(params.id)
  const b = await body<{ toRole: Role; reason?: string }>(req)
  if (!ROLES.includes(b.toRole)) throw new HttpError(400, 'Invalid role')
  const [t] = await db.select().from(tasks).where(eq(tasks.id, id))
  if (!t) throw new HttpError(404, 'Task not found')
  if (t.assignedRole === b.toRole) throw new HttpError(400, 'Task is already in that queue')
  const [m] = await db.select().from(messages).where(eq(messages.id, t.messageId))
  const reason = b.reason?.trim().slice(0, 500) || null

  // Save the correction as a labeled example for the Triage & Routing Agent.
  const [corr] = await db
    .insert(corrections)
    .values({
      taskId: id,
      messageText: `${m.subject}. ${t.excerpt || m.body}`,
      intent: t.intent,
      fromRole: t.assignedRole,
      toRole: b.toRole,
      reason,
      correctedBy: viewer.id,
    })
    .returning()
  const assignee = await pickAssignee(b.toRole, m.patientId)
  const [updated] = await db
    .update(tasks)
    .set({
      assignedRole: b.toRole,
      assignedStaffId: assignee,
      routedBy: 'reroute',
      reason: `Rerouted by ${viewer.name} from ${ROLE_LABELS[t.assignedRole as Role]}${reason ? `: ${reason}` : '.'}`,
      needsReview: false,
      prepStatus: 'pending',
      prepBrief: null,
    })
    .where(eq(tasks.id, id))
    .returning()
  await audit(viewer.id, 'task.rerouted', 'task', id, { from: t.assignedRole, to: b.toRole, reason, correctionId: corr.id })
  if (assignee)
    await notify({ staffId: assignee, kind: 'new_task', title: `Rerouted to you: task #${id}`, body: updated.reason, taskId: id })
  // Re-run the Prep Agent so the brief matches the new role.
  await triggerBackground(req, 'process-messages', { prepTaskIds: [id] })
  return { task: updated, correction: corr }
})

// ----------------------------------------------------------------- activity

route('GET', '/activity', async ({ url }) => {
  const after = Number(url.searchParams.get('after') ?? 0)
  const steps = await db
    .select({ step: agentSteps, agent: agentRuns.agent, messageId: agentRuns.messageId, taskId: agentRuns.taskId, evalRunId: agentRuns.evalRunId })
    .from(agentSteps)
    .innerJoin(agentRuns, eq(agentRuns.id, agentSteps.runId))
    .where(after ? gt(agentSteps.id, after) : undefined)
    .orderBy(desc(agentSteps.id))
    .limit(after ? 200 : 60)
  const autos = await db.select().from(automationRuns).orderBy(desc(automationRuns.id)).limit(15)
  const [{ running }] = await db.select({ running: sql<number>`count(*)::int` }).from(agentRuns).where(eq(agentRuns.status, 'running'))
  return {
    steps: steps.map((s) => ({ ...s.step, agent: s.agent, messageId: s.messageId, taskId: s.taskId, evalRunId: s.evalRunId })),
    automations: autos,
    runningAgents: running,
  }
})

route('GET', '/notifications', async ({ url }) => {
  const staffId = url.searchParams.get('staffId')
  if (!staffId) return []
  return db.select().from(notifications).where(eq(notifications.staffId, staffId)).orderBy(desc(notifications.id)).limit(30)
})

// ---------------------------------------------------------- manager: rules

route('GET', '/rules', async () => db.select().from(routingRules).orderBy(asc(routingRules.id)))

route('POST', '/rules', async ({ req, viewer }) => {
  requireManager(viewer)
  const b = await body<{ text: string }>(req)
  if (!b.text?.trim()) throw new HttpError(400, 'Rule text is required')
  const [r] = await db.insert(routingRules).values({ text: b.text.trim().slice(0, 500), createdBy: viewer.id }).returning()
  await audit(viewer.id, 'rule.created', 'rule', r.id, { text: r.text })
  return r
})

route('PATCH', '/rules/:id', async ({ req, params, viewer }) => {
  requireManager(viewer)
  const b = await body<{ text?: string; enabled?: boolean }>(req)
  const [r] = await db
    .update(routingRules)
    .set({ ...(b.text !== undefined && { text: b.text.trim().slice(0, 500) }), ...(b.enabled !== undefined && { enabled: b.enabled }), updatedAt: new Date() })
    .where(eq(routingRules.id, Number(params.id)))
    .returning()
  await audit(viewer.id, 'rule.updated', 'rule', params.id, b)
  return r
})

route('DELETE', '/rules/:id', async ({ params, viewer }) => {
  requireManager(viewer)
  await db.delete(routingRules).where(eq(routingRules.id, Number(params.id)))
  await audit(viewer.id, 'rule.deleted', 'rule', params.id)
  return { ok: true }
})

// --------------------------------------------------- manager: staff/settings

route('PATCH', '/staff/:id', async ({ req, params, viewer }) => {
  requireManager(viewer)
  const b = await body<{ available?: boolean; onDuty?: boolean }>(req)
  const [s] = await db
    .update(staff)
    .set({ ...(b.available !== undefined && { available: b.available }), ...(b.onDuty !== undefined && { onDuty: b.onDuty }) })
    .where(eq(staff.id, params.id))
    .returning()
  await audit(viewer.id, 'staff.availability_changed', 'staff', params.id, b)
  return s
})

route('PATCH', '/settings', async ({ req, viewer }) => {
  requireManager(viewer)
  const b = await body<{ key: keyof ClinicSettings; value: unknown }>(req)
  const allowed: (keyof ClinicSettings)[] = ['confidence_threshold', 'sla_emergency_minutes', 'sla_urgent_minutes', 'simulate_llm_outage', 'email_new_tasks']
  if (!allowed.includes(b.key)) throw new HttpError(400, 'Unknown setting')
  await updateSetting(b.key, b.value)
  await audit(viewer.id, 'setting.updated', 'setting', b.key, { value: b.value })
  return getSettings()
})

route('GET', '/analytics', async () => computeAnalytics())

route('GET', '/corrections', async () => db.select().from(corrections).orderBy(desc(corrections.id)).limit(100))

route('GET', '/audit', async () => db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(100))

// -------------------------------------------------------------- automations

route('GET', '/automations/runs', async () => db.select().from(automationRuns).orderBy(desc(automationRuns.id)).limit(60))

route('POST', '/automations/watchdog/run', async () => runSlaWatchdog('manual'))

route('POST', '/automations/daily-report/run', async () => sendDailyReport('manual'))

// --------------------------------------------------------------- evaluation

route('POST', '/eval/start', async ({ req }) => {
  const [running] = await db.select({ id: evalRuns.id }).from(evalRuns).where(eq(evalRuns.status, 'running')).limit(1)
  if (running) throw new HttpError(409, `Evaluation #${running.id} is still running`)
  const id = await createEvalRun()
  await triggerBackground(req, 'run-eval', { evalRunId: id })
  return { evalRunId: id }
})

route('GET', '/eval/runs', async () => db.select().from(evalRuns).orderBy(desc(evalRuns.id)).limit(20))

route('GET', '/eval/set', async () => EVAL_SET)

// ------------------------------------------------------------------- admin

route('POST', '/admin/reset', async ({ req, viewer }) => {
  requireManager(viewer)
  const b = await body<{ keepCorrections?: boolean }>(req).catch(() => ({ keepCorrections: false }))
  await resetDemo(Boolean(b.keepCorrections))
  await audit(viewer.id, 'demo.reset', 'system', null, b)
  return { ok: true }
})

// ------------------------------------------------------------------ handler

export default async (req: Request, ctx: Context) => {
  const url = new URL(req.url)
  try {
    await ensureSeeded()
    const viewerId = req.headers.get('x-demo-user') || 'S05'
    const [v] = await db.select().from(staff).where(eq(staff.id, viewerId))
    const viewer: Viewer = v ? { id: v.id, role: v.role, name: v.name } : { id: 'anonymous', role: 'none', name: 'Anonymous' }
    for (const r of routes) {
      if (r.method !== req.method) continue
      const params = matchPath(r.segments, url.pathname)
      if (!params) continue
      const out = await r.handler({ req, params, url, viewer, ctx })
      return Response.json(out ?? null)
    }
    return Response.json({ error: 'Not found' }, { status: 404 })
  } catch (err) {
    if (err instanceof HttpError) return Response.json({ error: err.message }, { status: err.status })
    console.error(err)
    return Response.json({ error: 'Server error', detail: String(err).slice(0, 300) }, { status: 500 })
  }
}

export const config: Config = {
  path: '/api/*',
}
