import { asc, eq } from 'drizzle-orm'
import { db, routingRules } from '../../db'
import {
  INTENTS,
  ROLES,
  URGENCIES,
  CLINICAL_ROLES,
  type Intent,
  type Role,
  type Urgency,
  type RoutedTaskDecision,
} from '../../shared/domain'
import {
  AGENT_MODEL,
  FAST_MODEL,
  LlmUnavailableError,
  ToolInputError,
  finishAgentRun,
  logStep,
  runToolLoop,
  startAgentRun,
  structuredCall,
  type AgentTool,
  type RunRecord,
} from '../llm'
import { getPatient, getStaffMap, pickAssignee, staffDirectory, ageFromDob } from '../clinic'
import { similarCorrections } from '../similarity'
import { getSettings, type ClinicSettings } from '../settings'

export interface TriageInput {
  messageId: number | null
  evalRunId?: number | null
  patientId: string
  portalType: string
  subject: string
  body: string
}

interface Ctx {
  input: TriageInput
  run: RunRecord
  rulesChecked: boolean
  correctionsChecked: boolean
}

const MAX_STEPS = 8

const SYSTEM = `You are the Triage & Routing Agent for a primary care clinic (synthetic demo data). Your only job is to decide WHO on the care team should handle an incoming patient portal message, before any reply is drafted. You never answer the patient, never give medical advice, and never make clinical decisions.

Care team roles:
- front_desk: scheduling, rescheduling, cancellations, records copies, general admin (hours, portal access).
- ma: medical assistant on the patient's pod — referral status, forms needing clinical input, routine questions about results already released, rooming/pre-visit prep.
- triage_rn: any new or worsening symptom, anything clinically uncertain, and the review queue for ambiguous or low-confidence messages.
- pharmacy: routine refills of non-controlled maintenance medications, medication logistics.
- billing: statements, charges, payment plans, insurance coverage, prior authorization.
- physician: the patient's PCP/APP — only items that truly need a prescriber's judgment (e.g. controlled-substance refills, treatment changes, result interpretation that changes care).

Goal: physicians receive only what truly needs a physician, and every message reaches someone who can act on it.

How to work (decide your own steps, but be efficient):
1. Call classify_message for a fast first-pass read of intents and urgency.
2. Call get_routing_rules (required before submitting). The clinic's rules override your defaults.
3. Call get_similar_past_corrections with the message gist — staff corrections show how THIS clinic routes; follow them when the situation matches.
4. Call get_patient_context only when the decision depends on the chart (e.g. is the medication controlled? who is the PCP? was this lab released?).
5. Call get_staff_directory for the chosen role(s) to pick a specific available person; prefer the patient's own PCP/pod MA when the role is physician or ma, and lighter queues otherwise.
6. Call submit_routing_decision. If the message contains several distinct requests (e.g. a refill AND a reschedule), submit one task per request, each with its own role.

Urgency: routine | same_day (clinical but should be handled today) | urgent (needs a clinician within ~1 hour, e.g. high fever for days, flank pain with urinary symptoms) | emergency (life-threatening; send to triage_rn).

Confidence: 0–1, how sure you are that the chosen role is correct. If the message is vague, missing key information, or you are unsure about a clinical item, do NOT guess: route it to triage_rn with needs_review=true and a review_note saying exactly what is unclear.

Before each tool call write ONE short sentence explaining why you're calling it (this is shown to the clinic as an activity log). Keep reasons to 1–2 plain sentences that cite the rule or evidence used.`

function tools(): AgentTool<Ctx>[] {
  return [
    {
      name: 'classify_message',
      description:
        'Fast first-pass classifier (small model). Returns candidate intents with the text span for each, an urgency guess, and whether the message is ambiguous.',
      input_schema: { type: 'object', properties: {} },
      run: async (_input, ctx) =>
        structuredCall({
          model: FAST_MODEL,
          run: ctx.run,
          system:
            'You label primary-care patient portal messages. Do not give advice. A message can contain several distinct requests; list each separately.',
          prompt: `Portal type chosen by patient: ${ctx.input.portalType}\nSubject: ${ctx.input.subject}\nMessage:\n"""${ctx.input.body}"""`,
          toolName: 'record_classification',
          schema: {
            type: 'object',
            properties: {
              intents: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    intent: { type: 'string', enum: [...INTENTS] },
                    excerpt: { type: 'string', description: 'The part of the message for this intent' },
                  },
                  required: ['intent', 'excerpt'],
                },
              },
              urgency_guess: { type: 'string', enum: [...URGENCIES] },
              ambiguous: { type: 'boolean' },
              notes: { type: 'string' },
            },
            required: ['intents', 'urgency_guess', 'ambiguous', 'notes'],
          },
        }),
    },
    {
      name: 'get_routing_rules',
      description: "Returns the clinic manager's active routing rules (plain language) and the confidence threshold. Must be called before submitting.",
      input_schema: { type: 'object', properties: {} },
      run: async (_i, ctx) => {
        ctx.rulesChecked = true
        const rules = await db
          .select()
          .from(routingRules)
          .where(eq(routingRules.enabled, true))
          .orderBy(asc(routingRules.id))
        const s = await getSettings()
        return {
          confidence_threshold: s.confidence_threshold,
          rules: rules.map((r) => ({ id: r.id, rule: r.text })),
        }
      },
    },
    {
      name: 'get_similar_past_corrections',
      description:
        'Returns up to 3 past messages that staff rerouted, with the role the AI chose and the role staff corrected it to. Use as few-shot examples of this clinic\'s workflow.',
      input_schema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Gist of the message to match against' } },
        required: ['query'],
      },
      run: async (input: { query: string }, ctx) => {
        ctx.correctionsChecked = true
        const found = await similarCorrections(`${input.query} ${ctx.input.body}`)
        return found.length ? { corrections: found } : { corrections: [], note: 'No similar past corrections.' }
      },
    },
    {
      name: 'get_patient_context',
      description:
        "Synthetic chart summary: PCP and care team, active medications (with controlled flag, refills remaining, last fill), recent visits, labs (and whether released to the patient), open orders, next appointment.",
      input_schema: { type: 'object', properties: {} },
      run: async (_i, ctx) => {
        const p = await getPatient(ctx.input.patientId)
        if (!p) return { error: 'Patient not found' }
        const staffMap = await getStaffMap()
        const c = p.chart
        return {
          patient: { id: p.id, age: ageFromDob(p.dob), sex: p.sex },
          pcp: { id: p.pcpId, name: staffMap.get(p.pcpId)?.name },
          pod_ma: { id: p.maId, name: staffMap.get(p.maId)?.name },
          problems: c.problems,
          medications: c.medications.map((m) => ({
            name: m.name,
            dose: m.dose,
            controlled: m.controlled,
            refills_remaining: m.refillsRemaining,
            last_fill: m.lastFill,
          })),
          recent_visits: c.visits.slice(0, 3).map((v) => ({ date: v.date, type: v.type })),
          labs: c.labs.map((l) => ({ date: l.date, name: l.name, flag: l.flag, released_to_patient: l.resultedToPatient })),
          open_orders: c.orders.filter((o) => o.status !== 'completed'),
          next_appointment: c.nextAppointment,
        }
      },
    },
    {
      name: 'get_staff_directory',
      description: 'Lists staff for a role with availability, pod, charge-nurse flag, backup, and current open queue size.',
      input_schema: {
        type: 'object',
        properties: { role: { type: 'string', enum: [...ROLES] } },
        required: ['role'],
      },
      run: async (input: { role: Role }) => ({ staff: await staffDirectory(input.role) }),
    },
    {
      name: 'submit_routing_decision',
      description: 'Submit the final routing. One task per distinct request in the message.',
      input_schema: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            minItems: 1,
            maxItems: 4,
            items: {
              type: 'object',
              properties: {
                intent: { type: 'string', enum: [...INTENTS] },
                urgency: { type: 'string', enum: [...URGENCIES] },
                role: { type: 'string', enum: [...ROLES] },
                staff_id: { type: ['string', 'null'] },
                reason: { type: 'string', description: '1–2 sentences: why this role, citing rule/evidence' },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
                excerpt: { type: 'string', description: 'The part of the message this task covers' },
                needs_review: { type: 'boolean' },
                review_note: { type: ['string', 'null'] },
              },
              required: ['intent', 'urgency', 'role', 'staff_id', 'reason', 'confidence', 'excerpt', 'needs_review'],
            },
          },
        },
        required: ['tasks'],
      },
      run: async (input: { tasks: any[] }, ctx) => {
        if (!ctx.rulesChecked) throw new ToolInputError('Call get_routing_rules before submitting.')
        if (!Array.isArray(input.tasks) || input.tasks.length === 0) throw new ToolInputError('tasks must be a non-empty array')
        const staffMap = await getStaffMap()
        for (const t of input.tasks) {
          if (!INTENTS.includes(t.intent)) throw new ToolInputError(`Invalid intent ${t.intent}`)
          if (!ROLES.includes(t.role)) throw new ToolInputError(`Invalid role ${t.role}`)
          if (!URGENCIES.includes(t.urgency)) throw new ToolInputError(`Invalid urgency ${t.urgency}`)
          if (t.staff_id && staffMap.get(t.staff_id)?.role !== t.role)
            throw new ToolInputError(`staff_id ${t.staff_id} is not in role ${t.role}. Use get_staff_directory.`)
        }
        return input
      },
    },
  ]
}

// Deterministic guardrails applied after the agent decides. Each one that
// fires is logged so staff can see why a decision was changed.
async function applyGuardrails(
  raw: any[],
  input: TriageInput,
  s: ClinicSettings,
  run: RunRecord,
): Promise<RoutedTaskDecision[]> {
  const out: RoutedTaskDecision[] = []
  for (const t of raw) {
    let d: RoutedTaskDecision = {
      intent: t.intent as Intent,
      urgency: t.urgency as Urgency,
      role: t.role as Role,
      staffId: t.staff_id ?? null,
      reason: String(t.reason ?? '').slice(0, 400),
      confidence: Math.max(0, Math.min(1, Number(t.confidence) || 0)),
      excerpt: String(t.excerpt ?? '').slice(0, 600),
      needsReview: Boolean(t.needs_review),
      reviewNote: t.review_note ?? null,
    }
    const reroute = async (why: string, note: string) => {
      await logStep(run, 'guardrail', why, { from: d.role, to: 'triage_rn' })
      d = {
        ...d,
        role: 'triage_rn',
        staffId: null,
        needsReview: true,
        reviewNote: [note, d.reviewNote].filter(Boolean).join(' '),
      }
    }
    if (d.confidence < s.confidence_threshold && d.role !== 'triage_rn') {
      await reroute(
        `Confidence ${d.confidence.toFixed(2)} is below the ${s.confidence_threshold} threshold — sending to Triage RN review`,
        `Low confidence (${d.confidence.toFixed(2)}). AI's best guess was ${d.role}.`,
      )
    } else if (d.urgency === 'emergency' && d.role !== 'triage_rn') {
      await reroute('Agent flagged emergency urgency — emergencies always go to the Triage RN', 'AI flagged as possible emergency.')
    } else if (d.intent === 'symptom' && !CLINICAL_ROLES.includes(d.role)) {
      await reroute('Symptom routed to a non-clinical role — corrected to Triage RN', 'Symptom content needs clinical review.')
    } else if (d.urgency === 'urgent' && !['triage_rn', 'physician'].includes(d.role) && d.intent !== 'billing_insurance' && d.intent !== 'scheduling') {
      await reroute('Urgent clinical item must reach a nurse or physician', 'Urgent clinical item.')
    }
    if (d.needsReview && d.role !== 'triage_rn') {
      await reroute('Agent marked needs_review — review queue is Triage RN', 'Flagged for review by the agent.')
    }
    const staffMap = await getStaffMap()
    const chosen = d.staffId ? staffMap.get(d.staffId) : null
    if (!chosen || chosen.role !== d.role || !chosen.available || !chosen.onDuty) {
      const picked = await pickAssignee(d.role, input.patientId)
      if (d.staffId && picked !== d.staffId)
        await logStep(run, 'guardrail', `${chosen?.name ?? d.staffId} unavailable — assigned ${staffMap.get(picked ?? '')?.name ?? 'role queue'}`)
      d.staffId = picked
    }
    out.push(d)
  }
  return out
}

export interface TriageResult {
  decisions: RoutedTaskDecision[]
  runId: number
  routedBy: 'agent' | 'fallback'
}

export async function runTriageAgent(input: TriageInput): Promise<TriageResult> {
  const s = await getSettings()
  const run = await startAgentRun({ agent: 'triage', model: AGENT_MODEL, messageId: input.messageId, evalRunId: input.evalRunId })
  await logStep(run, 'plan', 'Received new portal message — deciding who should handle it', {
    patient: input.patientId,
    portal_type: input.portalType,
    subject: input.subject,
  })
  try {
    if (s.simulate_llm_outage) throw new LlmUnavailableError('Simulated LLM outage (manager setting)')
    const ctx: Ctx = { input, run, rulesChecked: false, correctionsChecked: false }
    const final = await runToolLoop<Ctx, { tasks: any[] }>({
      run,
      model: AGENT_MODEL,
      system: SYSTEM,
      task: `New portal message.\nPatient ID: ${input.patientId}\nPortal type chosen by patient: ${input.portalType}\nSubject: ${input.subject}\nMessage:\n"""${input.body}"""`,
      tools: tools(),
      finalTool: 'submit_routing_decision',
      ctx,
      maxSteps: MAX_STEPS,
    })
    const decisions = await applyGuardrails(final.tasks, input, s, run)
    await logStep(run, 'decision', `Routed as ${decisions.length} task(s): ${decisions.map((d) => d.role).join(', ')}`, decisions)
    await finishAgentRun(run, 'done', decisions)
    return { decisions, runId: run.runId, routedBy: 'agent' }
  } catch (err) {
    // Fallback: if the AI is unavailable or fails, nothing is lost — the
    // message goes to the Triage RN queue for manual routing.
    const msg = err instanceof Error ? err.message : String(err)
    await logStep(run, 'error', `AI routing unavailable — falling back to Triage RN queue`, { error: msg.slice(0, 300) })
    const staffId = await pickAssignee('triage_rn', input.patientId)
    const decisions: RoutedTaskDecision[] = [
      {
        intent: 'general_question',
        urgency: 'same_day',
        role: 'triage_rn',
        staffId,
        reason: 'AI routing was unavailable, so this message was sent to the Triage RN for manual routing.',
        confidence: 0,
        excerpt: input.body.slice(0, 600),
        needsReview: true,
        reviewNote: 'Fallback: route manually.',
      },
    ]
    await finishAgentRun(run, 'fallback', decisions, msg)
    return { decisions, runId: run.runId, routedBy: 'fallback' }
  }
}
