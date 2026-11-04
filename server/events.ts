import { eq, sql } from 'drizzle-orm'
import {
  db,
  auditLog,
  notifications,
  automationRuns,
  staff,
  type AutomationStep,
} from '../db'

export async function audit(
  actor: string,
  action: string,
  entity: string,
  entityId: string | number | null,
  detail?: unknown,
) {
  await db.insert(auditLog).values({
    actor,
    action,
    entity,
    entityId: entityId == null ? null : String(entityId),
    detail: detail ?? null,
  })
}

// Sends an in-app notification and, when Resend is configured, an email.
// All synthetic staff share one demo inbox (NOTIFY_EMAIL_TO) because their
// addresses are fake.
export async function notify(opts: {
  staffId: string
  kind: 'new_task' | 'emergency' | 'escalation' | 'daily_report'
  title: string
  body: string
  taskId?: number | null
  email?: boolean
}): Promise<{ id: number; emailStatus: string | null }> {
  let emailStatus: string | null = null
  if (opts.email) {
    const [person] = await db.select().from(staff).where(eq(staff.id, opts.staffId))
    emailStatus = await sendEmail(
      `[RightRoute demo] ${opts.title}`,
      `To: ${person?.name ?? opts.staffId} (${person?.title ?? 'staff'})\n\n${opts.body}\n\n— RightRoute concept prototype. Synthetic data only.`,
    )
  }
  const [row] = await db
    .insert(notifications)
    .values({
      staffId: opts.staffId,
      kind: opts.kind,
      title: opts.title,
      body: opts.body,
      taskId: opts.taskId ?? null,
      channel: opts.email ? 'email' : 'in_app',
      emailStatus,
    })
    .returning({ id: notifications.id })
  return { id: row.id, emailStatus }
}

export async function sendEmail(subject: string, text: string): Promise<string> {
  const key = Netlify.env.get('RESEND_API_KEY')
  const to = Netlify.env.get('NOTIFY_EMAIL_TO')
  if (!key || !to) return 'skipped'
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: Netlify.env.get('RESEND_FROM') || 'RightRoute Demo <onboarding@resend.dev>',
        to: [to],
        subject,
        text,
      }),
    })
    return res.ok ? 'sent' : `failed (${res.status})`
  } catch {
    return 'failed'
  }
}

// Automation run log. Each automation records its steps as they happen so the
// demo can show exactly what fired and why.
export async function startAutomationRun(
  automation: 'safety_screen' | 'sla_watchdog' | 'daily_report',
  trigger: 'event' | 'schedule' | 'manual',
  messageId?: number,
) {
  const [row] = await db
    .insert(automationRuns)
    .values({ automation, trigger, messageId: messageId ?? null })
    .returning({ id: automationRuns.id })
  return row.id
}

export async function logAutomationStep(
  runId: number,
  name: string,
  status: AutomationStep['status'],
  detail: string,
) {
  const step: AutomationStep = { name, status, detail, at: new Date().toISOString() }
  await db
    .update(automationRuns)
    .set({ steps: sql`${automationRuns.steps} || ${JSON.stringify([step])}::jsonb` })
    .where(eq(automationRuns.id, runId))
}

export async function finishAutomationRun(
  runId: number,
  status: 'done' | 'failed',
  summary: string,
) {
  await db
    .update(automationRuns)
    .set({ status, summary, finishedAt: new Date() })
    .where(eq(automationRuns.id, runId))
}
