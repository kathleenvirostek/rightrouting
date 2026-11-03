import { eq } from 'drizzle-orm'
import { db, tasks, messages } from '../../db'
import {
  CLINICAL_ROLES,
  INTENT_LABELS,
  ROLE_LABELS,
  type Intent,
  type Role,
} from '../../shared/domain'
import {
  AGENT_MODEL,
  FAST_MODEL,
  ToolInputError,
  finishAgentRun,
  logStep,
  runToolLoop,
  startAgentRun,
  structuredCall,
  type AgentTool,
  type RunRecord,
} from '../llm'
import { ageFromDob, getPatient, getStaffMap } from '../clinic'

// Intents where a staff member may send a plain-language reply. Clinical
// intents get a clinician summary + key questions, never a drafted reply.
const REPLY_INTENTS: Intent[] = [
  'scheduling',
  'billing_insurance',
  'forms_records',
  'referral',
  'general_question',
]

const SECTIONS = [
  'demographics',
  'appointments',
  'insurance_billing',
  'medications',
  'problems_allergies',
  'visits',
  'labs',
  'orders',
] as const
type Section = (typeof SECTIONS)[number]
const NON_CLINICAL_SECTIONS: Section[] = ['demographics', 'appointments', 'insurance_billing', 'orders']

export interface PrepBrief {
  mode: 'reply' | 'clinician_summary'
  brief: string[]
  keyQuestions: string[]
  protocolFlags: string[]
  suggestedReply: string | null
  // Set when reply mode gave up on a draft after MAX_REPLY_CHECKS failed checks.
  replyNote?: string | null
  readingGrade: number | null
  wordCount: number | null
  selfCheck: { passed: boolean; attempts: number; issues: string[] }
  sectionsUsed: string[]
}

interface Ctx {
  run: RunRecord
  role: Role
  intent: Intent
  patientId: string
  gathered: Record<string, unknown>
  lastCheck: { text: string; passed: boolean; issues: string[]; grade: number; words: number } | null
  checkAttempts: number
  replyChecks: number
  protocolFlags: string[]
}

const MAX_STEPS = 10
// After this many failed reply checks the agent submits the brief without a
// reply instead of revising until it hits MAX_STEPS and loses the whole brief.
const MAX_REPLY_CHECKS = 3
const replyCheckLimitHit = (ctx: Ctx) => ctx.replyChecks >= MAX_REPLY_CHECKS && !ctx.lastCheck?.passed

// ---------- deterministic readability + safety checks ----------

function syllables(word: string) {
  const w = word.toLowerCase().replace(/[^a-z]/g, '')
  if (w.length <= 3) return 1
  const m = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '').match(/[aeiouy]{1,2}/g)
  return Math.max(1, m?.length ?? 1)
}

export function readingGrade(text: string) {
  const sentences = Math.max(1, (text.match(/[.!?]+(\s|$)/g) ?? []).length)
  const words = text.split(/\s+/).filter((w) => /[a-z]/i.test(w))
  const wc = Math.max(1, words.length)
  const syl = words.reduce((s, w) => s + syllables(w), 0)
  const grade = 0.39 * (wc / sentences) + 11.8 * (syl / wc) - 15.59
  return { grade: Math.round(grade * 10) / 10, words: words.length }
}

const ADVICE_PATTERNS: RegExp[] = [
  /\byou (should|need to|must) (take|stop|start|increase|decrease|double|skip)\b/i,
  /\b(increase|decrease|double|stop|start) (your|the) (dose|medication|medicine)\b/i,
  /\byou (have|probably have|likely have|might have) (a|an)?\s?\w*(infection|disease|condition|diabetes|cancer)/i,
  /\bdiagnos(is|ed|e)\b/i,
  /\bi recommend\b/i,
  /\bit'?s (nothing|probably nothing|not serious|normal)\b/i,
  /\bno need to (worry|come in|see)\b/i,
]

// ---------- tools ----------

function tools(): AgentTool<Ctx>[] {
  return [
    {
      name: 'get_chart_section',
      description: `Fetch ONE section of the synthetic chart. Sections: ${SECTIONS.join(', ')}. Minimum-necessary: only fetch what this request needs. Non-clinical roles may only access demographics, appointments, insurance_billing, orders.`,
      input_schema: {
        type: 'object',
        properties: { section: { type: 'string', enum: [...SECTIONS] } },
        required: ['section'],
      },
      run: async (input: { section: Section }, ctx) => {
        if (!CLINICAL_ROLES.includes(ctx.role) && !NON_CLINICAL_SECTIONS.includes(input.section)) {
          return { access_denied: `Minimum-necessary policy: ${ROLE_LABELS[ctx.role]} cannot view ${input.section}.` }
        }
        const p = await getPatient(ctx.patientId)
        if (!p) return { error: 'Patient not found' }
        const staffMap = await getStaffMap()
        const c = p.chart
        const name = (id: string) => staffMap.get(id)?.name ?? id
        const data: Record<Section, unknown> = {
          demographics: { first_name: p.name.split(' ')[0], age: ageFromDob(p.dob), preferred_language: p.preferredLanguage, pcp: name(p.pcpId), pod_ma: name(p.maId) },
          appointments: { next_appointment: c.nextAppointment, last_visit: c.visits[0] ? { date: c.visits[0].date, type: c.visits[0].type } : null },
          insurance_billing: c.insurance,
          medications: c.medications.map((m) => ({ ...m, prescriber: name(m.prescriberId) })),
          problems_allergies: { problems: c.problems, allergies: c.allergies },
          visits: c.visits.map((v) => ({ ...v, provider: name(v.providerId) })),
          labs: c.labs,
          orders: c.orders,
        }
        ctx.gathered[input.section] = data[input.section]
        return data[input.section]
      },
    },
    {
      name: 'check_refill_protocol',
      description: 'Run the clinic refill protocol for a medication on the chart: controlled-substance, refills remaining, last visit within 12 months, and monitoring-lab checks. Returns flags.',
      input_schema: {
        type: 'object',
        properties: { medication: { type: 'string' } },
        required: ['medication'],
      },
      run: async (input: { medication: string }, ctx) => {
        const p = await getPatient(ctx.patientId)
        if (!p) return { error: 'Patient not found' }
        const q = input.medication.toLowerCase().split(' ')[0]
        const med = p.chart.medications.find((m) => m.name.toLowerCase().includes(q))
        if (!med) return { found: false, flags: [`${input.medication} is not on the active medication list — verify with patient`] }
        const flags: string[] = []
        const now = Date.now()
        const lastVisit = p.chart.visits.map((v) => new Date(v.date).getTime()).sort((a, b) => b - a)[0]
        if (med.controlled) flags.push('Controlled substance — prescriber (PCP) must authorize; check PDMP')
        if (med.refillsRemaining <= 0) flags.push('0 refills remaining — needs new prescription from prescriber')
        if (!lastVisit || now - lastVisit > 365 * 86_400_000) flags.push('No visit in the last 12 months — protocol requires a visit')
        const monitoring: Record<string, string[]> = {
          lisinopril: ['bmp', 'metabolic', 'potassium', 'creatinine'],
          losartan: ['bmp', 'metabolic', 'potassium', 'creatinine'],
          metformin: ['a1c', 'hemoglobin a1c'],
          levothyroxine: ['tsh'],
          atorvastatin: ['lipid', 'ldl'],
          simvastatin: ['lipid', 'ldl'],
          rosuvastatin: ['lipid', 'ldl'],
        }
        const key = Object.keys(monitoring).find((k) => med.name.toLowerCase().includes(k))
        if (key) {
          const lab = p.chart.labs.find((l) => monitoring[key].some((n) => l.name.toLowerCase().includes(n)))
          if (!lab) flags.push(`No monitoring lab on file for ${key}`)
          else if (now - new Date(lab.date).getTime() > 365 * 86_400_000) flags.push(`Monitoring lab (${lab.name}) older than 12 months`)
          else if (lab.flag !== 'normal') flags.push(`Most recent ${lab.name} is ${lab.flag} (${lab.result}) — prescriber may want to review`)
        }
        if (!flags.length) flags.push('Meets protocol — eligible for protocol refill by pharmacy')
        ctx.protocolFlags = flags
        ctx.gathered[`protocol_${med.name}`] = { med, flags }
        return { found: true, medication: med, flags }
      },
    },
    {
      name: 'check_draft',
      description:
        'Self-check a draft BEFORE submitting. Measures reading grade level and word count, scans for diagnosis/treatment advice, and verifies every fact against the chart data you gathered. Returns pass/fail with issues; revise and re-check if it fails.',
      input_schema: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['reply', 'clinician_summary'] },
          text: { type: 'string' },
        },
        required: ['kind', 'text'],
      },
      run: async (input: { kind: 'reply' | 'clinician_summary'; text: string }, ctx) => {
        if (input.kind === 'reply' && replyCheckLimitHit(ctx))
          throw new ToolInputError(
            `Draft check limit reached (${MAX_REPLY_CHECKS} failed checks). Stop revising: call submit_prep_brief with suggested_reply null and a short reply_note for staff.`,
          )
        ctx.checkAttempts++
        if (input.kind === 'reply') ctx.replyChecks++
        const issues: string[] = []
        const { grade, words } = readingGrade(input.text)
        if (input.kind === 'reply') {
          if (words > 120) issues.push(`Too long: ${words} words (max 120)`)
          if (grade > 8.5) issues.push(`Reading level grade ${grade} (target 6–8): use shorter sentences and simpler words`)
        } else if (words > 180) issues.push(`Clinician summary too long: ${words} words (max 180)`)
        for (const p of ADVICE_PATTERNS) {
          const m = input.text.match(p)
          if (m && input.kind === 'reply') issues.push(`Possible medical advice/diagnosis: "${m[0]}"`)
        }
        const factCheck = await structuredCall<{ unsupported_facts: string[]; advice: string[] }>({
          model: FAST_MODEL,
          run: ctx.run,
          system:
            'You audit drafts written for clinic staff. List any specific factual claims (dates, doses, values, names, amounts) NOT supported by the provided chart data or patient message, and any diagnosis or treatment advice directed at the patient. Be strict but do not flag generic statements like "a team member will contact you".',
          prompt: `Draft type: ${input.kind}\nChart data gathered:\n${JSON.stringify(ctx.gathered)}\n\nDraft:\n"""${input.text}"""`,
          toolName: 'record_audit',
          schema: {
            type: 'object',
            properties: {
              unsupported_facts: { type: 'array', items: { type: 'string' } },
              advice: { type: 'array', items: { type: 'string' } },
            },
            required: ['unsupported_facts', 'advice'],
          },
        })
        for (const f of factCheck.unsupported_facts ?? []) issues.push(`Not in chart: ${f}`)
        if (input.kind === 'reply') for (const a of factCheck.advice ?? []) issues.push(`Medical advice: ${a}`)
        const passed = issues.length === 0
        ctx.lastCheck = { text: input.text, passed, issues, grade, words }
        if (!passed && input.kind === 'reply' && replyCheckLimitHit(ctx))
          return {
            passed,
            reading_grade: grade,
            word_count: words,
            issues,
            next_step: 'Check limit reached. Submit the brief now with suggested_reply null and a short reply_note saying staff should write the reply.',
          }
        return { passed, reading_grade: grade, word_count: words, issues }
      },
    },
    {
      name: 'submit_prep_brief',
      description: 'Submit the final prep brief. Include suggested_reply only in reply mode, and only after check_draft passed on that exact text.',
      input_schema: {
        type: 'object',
        properties: {
          brief: { type: 'array', items: { type: 'string' }, description: '3–6 short bullets for the assignee' },
          key_questions: { type: 'array', items: { type: 'string' }, description: 'Clinical mode: 2–4 questions for the clinician to consider' },
          suggested_reply: { type: ['string', 'null'] },
          reply_note: {
            type: 'string',
            description: `Reply mode only, when no draft passed check_draft after ${MAX_REPLY_CHECKS} tries: one sentence telling staff to write the reply themselves and what to cover. Never include the unverified draft.`,
          },
        },
        required: ['brief'],
      },
      run: async (input: SubmitInput, ctx) => {
        const replyMode = REPLY_INTENTS.includes(ctx.intent)
        if (!replyMode && input.suggested_reply)
          throw new ToolInputError('This is a clinical item: do NOT include a patient reply. Provide brief + key_questions only.')
        if (replyMode) {
          if (!input.suggested_reply) {
            if (!replyCheckLimitHit(ctx))
              throw new ToolInputError(
                `Reply mode requires a suggested_reply that passed check_draft. Only after ${MAX_REPLY_CHECKS} failed checks may you submit without one (with reply_note).`,
              )
            if (!input.reply_note?.trim()) throw new ToolInputError('Submitting without a reply requires a short reply_note for staff.')
            await logStep(ctx.run, 'guardrail', 'No draft passed the self-check, so the brief is saved without a suggested reply', {
              failedChecks: ctx.replyChecks,
              lastIssues: ctx.lastCheck?.issues ?? [],
            })
            return input
          }
          if (!ctx.lastCheck || ctx.lastCheck.text.trim() !== input.suggested_reply.trim() || !ctx.lastCheck.passed)
            throw new ToolInputError('Run check_draft on this exact suggested_reply and get passed=true before submitting.')
        }
        if (!replyMode && !(input.key_questions?.length)) throw new ToolInputError('Clinical mode requires key_questions.')
        return input
      },
    },
  ]
}

type SubmitInput = { brief: string[]; key_questions?: string[]; suggested_reply?: string | null; reply_note?: string }

export async function runPrepAgent(taskId: number) {
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId))
  if (!task) return
  const [message] = await db.select().from(messages).where(eq(messages.id, task.messageId))
  const role = task.assignedRole as Role
  const intent = task.intent as Intent
  const replyMode = REPLY_INTENTS.includes(intent) && task.urgency !== 'emergency'
  await db.update(tasks).set({ prepStatus: 'running' }).where(eq(tasks.id, taskId))

  const run = await startAgentRun({ agent: 'prep', model: AGENT_MODEL, messageId: task.messageId, taskId })
  await logStep(run, 'plan', `Preparing a ${replyMode ? 'reply draft' : 'clinician summary'} for ${ROLE_LABELS[role]}`, {
    intent: INTENT_LABELS[intent],
    urgency: task.urgency,
  })
  const ctx: Ctx = { run, role, intent, patientId: message.patientId, gathered: {}, lastCheck: null, checkAttempts: 0, replyChecks: 0, protocolFlags: [] }

  const system = `You are the Care Team Prep Agent for a primary care clinic (synthetic demo data). A message has already been routed. Your job: prepare the assigned staff member to act quickly. Keep everything short and matched to who will actually handle it — AI drafts in this clinic have been too long and too complex.

Assigned role: ${ROLE_LABELS[role]} (${CLINICAL_ROLES.includes(role) ? 'clinical' : 'non-clinical'})
Request type: ${INTENT_LABELS[intent]} | Urgency: ${task.urgency}
Mode: ${replyMode ? 'REPLY — draft a plain-language suggested reply for staff to edit and send' : 'CLINICIAN SUMMARY — no patient reply; summarize and list key questions'}

Steps (decide which are needed):
1. Gather ONLY the chart sections relevant to this request with get_chart_section (minimum necessary — e.g. billing needs insurance_billing, never meds or labs).
2. For refills, call check_refill_protocol for the medication.
3. Write the brief: 3–6 bullets, each under 20 words, only facts from the message or chart. Refill → med, dose, last fill, refills left, last visit, protocol flags. Billing → no clinical details.
4. ${replyMode ? 'Draft suggested_reply: 6th–8th grade reading level, under 120 words, warm, short sentences, address the patient by first name, no medical advice, no promises the clinic cannot keep, sign as "Your care team". Call check_draft(kind="reply"); if it fails, revise and check again. After ${MAX_REPLY_CHECKS} failed checks, stop and submit with suggested_reply null plus a one-sentence reply_note for staff.' : 'Write 2–4 key_questions for the clinician. Optionally call check_draft(kind="clinician_summary") on your brief joined as text to confirm no unsupported facts. Do NOT write a reply to the patient.'}
5. Call submit_prep_brief.

Never diagnose, never recommend treatment, never invent facts. Before each tool call, write one short sentence saying why.`

  try {
    const final = await runToolLoop<Ctx, SubmitInput>({
      run,
      model: AGENT_MODEL,
      system,
      task: `Patient ID: ${message.patientId}\nSubject: ${message.subject}\nPart of the message this task covers:\n"""${task.excerpt || message.body}"""\n\nFull message for context:\n"""${message.body}"""\n\nRouting reason: ${task.reason}`,
      tools: tools(),
      finalTool: 'submit_prep_brief',
      ctx,
      maxSteps: MAX_STEPS,
    })
    const brief: PrepBrief = {
      mode: replyMode ? 'reply' : 'clinician_summary',
      brief: final.brief.slice(0, 8),
      keyQuestions: final.key_questions ?? [],
      protocolFlags: ctx.protocolFlags,
      suggestedReply: replyMode ? (final.suggested_reply ?? null) : null,
      replyNote: replyMode && !final.suggested_reply ? (final.reply_note?.trim() ?? null) : null,
      readingGrade: ctx.lastCheck?.grade ?? null,
      wordCount: ctx.lastCheck?.words ?? null,
      selfCheck: { passed: ctx.lastCheck?.passed ?? true, attempts: ctx.checkAttempts, issues: ctx.lastCheck?.issues ?? [] },
      sectionsUsed: Object.keys(ctx.gathered),
    }
    await db.update(tasks).set({ prepStatus: 'done', prepBrief: brief }).where(eq(tasks.id, taskId))
    await finishAgentRun(run, 'done', brief)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await logStep(run, 'error', 'Prep brief failed — staff will work from the original message', { error: msg.slice(0, 300) })
    await db.update(tasks).set({ prepStatus: 'failed' }).where(eq(tasks.id, taskId))
    await finishAgentRun(run, 'failed', null, msg)
  }
}
