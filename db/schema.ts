import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  real,
  index,
} from 'drizzle-orm/pg-core'
import type { Chart } from '../shared/domain'

export const patients = pgTable('patients', {
  id: text().primaryKey(),
  name: text().notNull(),
  dob: text().notNull(),
  sex: text().notNull(),
  mrn: text().notNull(),
  phone: text().notNull(),
  preferredLanguage: text('preferred_language').notNull().default('English'),
  pcpId: text('pcp_id').notNull(),
  maId: text('ma_id').notNull(),
  chart: jsonb().$type<Chart>().notNull(),
})

export const staff = pgTable('staff', {
  id: text().primaryKey(),
  name: text().notNull(),
  role: text().notNull(), // Role | 'manager'
  title: text().notNull(),
  email: text().notNull(),
  pod: text(),
  available: boolean().notNull().default(true),
  onDuty: boolean('on_duty').notNull().default(true),
  isChargeNurse: boolean('is_charge_nurse').notNull().default(false),
  backupId: text('backup_id'),
  shift: text().notNull().default('8:00–17:00'),
})

export const routingRules = pgTable('routing_rules', {
  id: serial().primaryKey(),
  text: text().notNull(),
  enabled: boolean().notNull().default(true),
  createdBy: text('created_by').notNull().default('system'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const settings = pgTable('settings', {
  key: text().primaryKey(),
  value: jsonb().notNull(),
})

export const messages = pgTable(
  'messages',
  {
    id: serial().primaryKey(),
    patientId: text('patient_id').notNull(),
    portalType: text('portal_type').notNull(),
    subject: text().notNull(),
    body: text().notNull(),
    source: text().notNull().default('portal'), // portal | sample
    status: text().notNull().default('received'), // received | routing | routed | emergency | failed
    isEmergency: boolean('is_emergency').notNull().default(false),
    redFlags: jsonb('red_flags').$type<string[]>().notNull().default([]),
    patientAutoReply: text('patient_auto_reply'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('messages_created_idx').on(t.createdAt)],
)

export const tasks = pgTable(
  'tasks',
  {
    id: serial().primaryKey(),
    messageId: integer('message_id').notNull(),
    intent: text().notNull(),
    urgency: text().notNull(),
    assignedRole: text('assigned_role').notNull(),
    assignedStaffId: text('assigned_staff_id'),
    originalRole: text('original_role').notNull(),
    reason: text().notNull(),
    confidence: real().notNull(),
    excerpt: text().notNull().default(''),
    routedBy: text('routed_by').notNull(), // safety_screen | agent | fallback | reroute
    needsReview: boolean('needs_review').notNull().default(false),
    reviewNote: text('review_note'),
    status: text().notNull().default('open'), // open | accepted | rerouted
    priority: integer().notNull().default(0),
    slaDueAt: timestamp('sla_due_at', { withTimezone: true }).notNull(),
    acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
    acknowledgedBy: text('acknowledged_by'),
    escalationCount: integer('escalation_count').notNull().default(0),
    lastEscalatedAt: timestamp('last_escalated_at', { withTimezone: true }),
    prepStatus: text('prep_status').notNull().default('pending'), // pending | running | done | failed | skipped
    prepBrief: jsonb('prep_brief'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('tasks_message_idx').on(t.messageId),
    index('tasks_role_status_idx').on(t.assignedRole, t.status),
  ],
)

export const corrections = pgTable('corrections', {
  id: serial().primaryKey(),
  taskId: integer('task_id').notNull(),
  messageText: text('message_text').notNull(),
  intent: text().notNull(),
  fromRole: text('from_role').notNull(),
  toRole: text('to_role').notNull(),
  reason: text(),
  correctedBy: text('corrected_by').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: serial().primaryKey(),
    agent: text().notNull(), // triage | prep
    messageId: integer('message_id'),
    taskId: integer('task_id'),
    evalRunId: integer('eval_run_id'),
    status: text().notNull().default('running'), // running | done | failed | fallback
    model: text().notNull(),
    stepCount: integer('step_count').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    output: jsonb(),
    error: text(),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [index('agent_runs_message_idx').on(t.messageId)],
)

export const agentSteps = pgTable(
  'agent_steps',
  {
    id: serial().primaryKey(),
    runId: integer('run_id').notNull(),
    stepNo: integer('step_no').notNull(),
    kind: text().notNull(), // plan | tool_call | tool_result | llm | decision | guardrail | error
    title: text().notNull(),
    detail: jsonb(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index('agent_steps_run_idx').on(t.runId)],
)

export interface AutomationStep {
  name: string
  status: 'ok' | 'skipped' | 'failed' | 'fired'
  detail: string
  at: string
}

export const automationRuns = pgTable('automation_runs', {
  id: serial().primaryKey(),
  automation: text().notNull(), // safety_screen | sla_watchdog | daily_report
  trigger: text().notNull(), // event | schedule | manual
  status: text().notNull().default('running'), // running | done | failed
  messageId: integer('message_id'),
  steps: jsonb().$type<AutomationStep[]>().notNull().default([]),
  summary: text(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
})

export const notifications = pgTable('notifications', {
  id: serial().primaryKey(),
  staffId: text('staff_id').notNull(),
  kind: text().notNull(), // new_task | emergency | escalation | daily_report
  title: text().notNull(),
  body: text().notNull(),
  taskId: integer('task_id'),
  channel: text().notNull().default('in_app'), // in_app | email
  emailStatus: text('email_status'), // sent | skipped | failed
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const auditLog = pgTable('audit_log', {
  id: serial().primaryKey(),
  actor: text().notNull(),
  action: text().notNull(),
  entity: text().notNull(),
  entityId: text('entity_id'),
  detail: jsonb(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const evalRuns = pgTable('eval_runs', {
  id: serial().primaryKey(),
  status: text().notNull().default('running'),
  total: integer().notNull(),
  completed: integer().notNull().default(0),
  accuracy: real(),
  emergencyRecall: real('emergency_recall'),
  physicianPct: real('physician_pct'),
  correctionsAvailable: integer('corrections_available').notNull().default(0),
  results: jsonb().$type<unknown[]>().notNull().default([]),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
})
