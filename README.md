# RightRoute: AI routing for patient portal messages

> **Concept prototype. Synthetic data. Not affiliated with or endorsed by UCHealth or Epic.**
> Capstone project for the CU Boulder AI Club Applied AI Development Program.

RightRoute looks at every incoming patient portal message before anyone drafts a reply. It screens the message for emergencies, works out what the patient is asking for, judges urgency, and sends it to the right person on the care team with a short reason. Physicians get only the messages that need a physician, and every message reaches someone who can act on it.

## User and problem

**Organization:** UCHealth, Aurora, Colorado. The scenario is one primary care clinic.

**Intended users:**
- The clinic care team: front desk and schedulers, medical assistants (MAs), triage RNs, pharmacists, billing staff, and physicians/APPs.
- The clinic operations manager.
- Patients benefit indirectly.

**Operational problem:** Patient portal messages often reach the wrong person. UCHealth uses a generative AI tool in Epic to draft portal replies, but physicians are receiving more messages, and more complex AI-drafted ones. A nurse, scheduler, pharmacist or billing team could handle many of these. As a result, physicians lose time, simple requests wait in the wrong inbox, and urgent messages can be delayed.

**Solution:**
1. A rule-based safety screen catches emergencies instantly.
2. The Triage & Routing Agent classifies every other message and splits multi-intent messages into separate tasks.
3. Each task goes to a role and a specific person, with a 1–2 sentence reason, a confidence score and an SLA timer.
4. The Care Team Prep Agent writes a short brief matched to whoever will handle the task.

Humans make all clinical decisions. RightRoute never gives medical advice and never sends a clinical reply on its own.

## Architecture

```
 Patient Portal Simulator (React)
            │  POST /api/messages
            ▼
┌─────────── AUTOMATION 1: Safety Screen & Queue  (trigger: new-message event) ───────────┐
│ 1. Red-flag rule screen (regex, NO AI) ──match──► Emergency: fixed 911/ER template to    │
│        │ no match                                 patient + alert on-duty Triage RN      │
│        ▼                                                                                 │
│ 2. Background Function ─► TRIAGE & ROUTING AGENT (Claude tool-use loop, ≤8 steps)       │
│        tools: classify_message (Haiku) · get_routing_rules · get_similar_past_corrections│
│               get_patient_context · get_staff_directory · submit_routing_decision        │
│        + deterministic guardrails (confidence threshold → Triage RN review, etc.)        │
│ 3. Create task(s) in role queues + SLA timer (urgent 1h · clinical same day · admin 2d)  │
│ 4. Notify assignee (in-app + Resend email) + audit log                                   │
└──────────────────────────────────────────────────────────────────────────────────────────┘
            │ for each task
            ▼
   CARE TEAM PREP AGENT (Claude tool-use loop, ≤10 steps)
     tools: get_chart_section (minimum-necessary by role) · check_refill_protocol
            check_draft (reading grade + length + advice scan + Haiku fact-check) · submit_prep_brief
            │
            ▼
 Routing Dashboard ── Accept / Reroute ──► corrections table ──► retrieved as few-shot
 Message detail · Agent activity panel                              examples by Agent 1
            ▲
┌── AUTOMATION 2: SLA Watchdog & Daily Report (Scheduled Function every 15 min + "Run now") ─┐
│ 1. Find unacknowledged tasks past SLA  2. Reassign to backup / charge nurse, bump priority│
│ 3. Notify backup + manager             4. Once daily after 5 pm: email manager summary   │
└──────────────────────────────────────────────────────────────────────────────────────────┘

 Storage: Netlify Database (Postgres + Drizzle ORM): patients, staff, routing_rules, settings,
          messages, tasks, corrections, agent_runs, agent_steps, automation_runs,
          notifications, audit_log, eval_runs
 AI:      Claude via Netlify AI Gateway. claude-sonnet-5-5 drives the agents;
          claude-haiku-5-5 handles the cheap classification and fact-check passes
```

### Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React 19 + Vite + TypeScript + Tailwind CSS 4 (TanStack Start/Router), shadcn/ui components |
| Backend | Netlify Functions (TypeScript): `api` (REST router), `process-messages` (Background), `run-eval` (Background), `sla-watchdog` (Scheduled) |
| Database | Netlify Database (managed Postgres) with Drizzle ORM |
| AI | Anthropic Claude via Netlify AI Gateway (`@anthropic-ai/sdk`), with no API key to manage |
| Email | Resend free tier (optional; otherwise in-app notifications) |

## How the requirements are met

### Requirement 1: two AI agents

Both agents run on the same engine (`server/llm.ts → runToolLoop`). On each turn, Claude decides which tool to call next, and the loop runs that tool and returns the result. The loop ends only when the model calls its final "submit" tool with valid input. Each agent has a hard step limit, and every reasoning sentence, tool call, tool result, guardrail and decision is written to `agent_steps`. The Agent activity panel and the message trace show these steps live.

**Agent 1: Triage & Routing Agent** (`server/agents/triage.ts`)
- **Input:** a portal message and the patient ID.
- **What it decides for itself:** which tools to call and in what order. For example, it pulls the chart only when the decision depends on it, such as "is this med controlled?".
- **Tools:** classify_message (a Haiku first pass), get_routing_rules, get_similar_past_corrections, get_patient_context, get_staff_directory and submit_routing_decision.
- **Splitting:** it splits multi-intent messages into separate tasks.
- **Checks on its output:**
  - The submit tool rejects input that skipped the rules check or picked a staff member from the wrong role. The model then corrects itself.
  - After it decides, deterministic guardrails apply. Confidence below the threshold (default 0.7) goes to the Triage RN review queue with a note. So do emergencies the agent flags and symptoms sent to a non-clinical role. Unavailable staff are swapped for an available person.
- **If the LLM is down:** the message falls back to the Triage RN queue.

**Agent 2: Care Team Prep Agent** (`server/agents/prep.ts`)
- **Input:** a routed task and its assigned role.
- **Chart access:** it fetches only the chart sections it needs. Non-clinical roles are blocked from clinical sections (minimum-necessary access).
- **Refills:** it runs the clinic refill protocol, which checks for controlled substances, zero refills left, a visit within 12 months and monitoring labs.
- **Admin items** (scheduling, billing, forms, referrals, general questions): it drafts a plain-language reply for staff to edit. The target is a 6th–8th grade reading level and under 120 words.
- **Clinical items:** it writes a summary and key questions for the clinician, never a reply. The submit tool enforces this.
- **Self-check:** `check_draft` measures the Flesch-Kincaid grade and word count, scans for advice or diagnosis phrasing, and has Haiku verify every fact against the chart data the agent gathered. The agent has to revise until the check passes.

### Requirement 2: two automations

**Automation 1: Safety Screen & Queue** (`server/pipeline.ts`). Trigger: a new portal message arrives.
1. A deterministic red-flag screen runs before any AI (`server/red-flags.ts`). On a match, the message is marked Emergency, the patient gets a fixed pre-approved template, and the on-duty Triage RN is alerted.
2. Non-emergency messages go to the Triage & Routing Agent in a Background Function.
3. Tasks are created in the assigned queues with SLA timers: emergency 15 min, urgent 1 h, clinical by end of the same business day, admin within 2 business days (America/Denver).
4. The assignee is notified and an audit entry is written.

Every run is logged in `automation_runs` with each step.

**Automation 2: SLA Watchdog & Daily Report** (`server/watchdog.ts`). Trigger: a Netlify Scheduled Function every 15 minutes, plus a "Run now" button.
1. Finds unacknowledged tasks past their SLA.
2. Reassigns each one to the role's backup, or to the charge nurse for clinical items, and bumps its priority.
3. Notifies the backup and the clinic manager.
4. Once a day after 5 pm, emails the manager a summary: volume by category, % sent to physicians, reroute rate and SLA breaches. "Send daily report now" triggers it on demand.

### Customization: learning from corrections

- Every **Reroute** saves a labeled example to the `corrections` table. Agent 1 calls `get_similar_past_corrections`, which uses TF-IDF cosine similarity, and uses the closest matches as few-shot examples. Routing adapts to this clinic's workflow without fine-tuning.
- The manager edits **plain-language routing rules**. The agent must read them before every decision, because the submit tool refuses otherwise.
- The **Manager → Analytics** page shows the reroute rate per batch of 10 routed tasks, and accuracy across evaluation runs, as evidence that routing is learning.

### Evaluation

`shared/eval-set.ts` holds 30 labeled synthetic messages: 6 emergencies, 4 multi-intent and 3 ambiguous, with the rest spread across categories. **Evaluate** runs them through the real screen and agent in dry-run mode in a Background Function. It reports:
- Routing accuracy: the exact set of roles must match.
- Emergency-detection recall: must be 100%.
- % routed to physicians, compared with the labeled target.

## 3-minute demo script

1. **Portal → "Refill request" → Send.** It goes to Pharmacy, not the physician. Watch the Agent activity panel.
2. **"Billing question"** goes to Billing. The prep brief has no clinical details and includes a simple draft reply.
3. **"Multi-intent"** is split into two tasks, for example Pharmacy and Front Desk.
4. **"Chest pain"** makes the emergency screen fire instantly with no AI: the fixed 911/ER reply is sent and the RN is alerted.
5. **Dashboard → Reroute** one card. The correction is saved and shows under Manager → Corrections.
6. **Manager → Automations → "Demo: fast-forward 3 SLAs" → "Run watchdog now".** Tasks are escalated to the backup or charge nurse.
7. **Manager → Analytics:** % to physicians before vs. after, reroute rate and SLA breaches.

Before the demo, run **Load 25 sample messages** so the queues and analytics have volume. Use **Manager → Settings → Reset** to rehearse from a clean state.

## Points of Failure & Trust

For each risk below: what could go wrong, what RightRoute does about it, and how far the clinic could trust it without human review.

| Risk | Mitigation in RightRoute | Trust without human review |
| --- | --- | --- |
| **Missed urgent message** | The deterministic red-flag screen runs first and is tuned to over-escalate. The agent can also flag emergencies, and guardrails force them to the Triage RN. Symptoms always reach a clinical role. Urgent items get a 1-hour SLA, and the watchdog escalates to the charge nurse. Eval requires 100% emergency recall. | **Low.** The screen is rule-based and errs toward over-escalating, but a keyword list can never be complete. Patients must still be told portal messages aren't for emergencies, and an RN confirms every urgent or clinical routing. |
| **Misrouting** | Every card shows a reason and a confidence score. Low confidence goes to the Triage RN review queue. One-click Reroute saves a correction the agent learns from. The reroute rate is tracked over time. | **Administrative routing** (scheduling, billing, records) can run unattended with periodic spot checks of the reroute rate and audit log. **Clinical routing** always needs a human to confirm. |
| **Multi-intent messages** | The agent splits each request into its own task with its own role, urgency and SLA. Cards show "1 of N". The detail view shows all sibling tasks. | **Medium.** Splitting is usually right, but a missed second request is possible. Assignees see the full original message, not just their excerpt. |
| **Over-routing to physicians** | Clinic rules send routine refills to Pharmacy and results questions to MAs, and the agent's instructions reserve physicians for prescriber judgment. Analytics show % to physicians before vs. after, and eval tracks it against the labeled target. | **Monitor.** The manager reviews the physician share weekly. Over-routing costs time, not safety. |
| **LLM outage** | Any AI failure, timeout or step-limit hit falls back to the Triage RN queue with "route manually" (demo: Manager → Settings → Simulate LLM outage). The emergency screen doesn't use AI, so it keeps working. | **Safe by design.** Nothing is lost; the clinic simply reverts to manual triage until the AI is back. |
| **PHI privacy and HIPAA** | This prototype uses 100% synthetic data and has no Epic connection. The Prep Agent enforces minimum-necessary chart access by role, and the detail view hides clinical data from non-clinical roles. A full audit log is kept. | **Not deployable with real PHI as-is.** A real deployment needs a signed BAA with the AI vendor and the hosting provider, real authentication (SSO) instead of the demo role switcher, encryption and retention policies, and Epic integration through its FHIR and In Basket APIs. |
| **Staff over-trusting the AI** | Every decision shows its reason, confidence and full step trace. Drafts are labeled "edit before sending" and are never sent automatically. Clinical items get questions, not answers. Accept and Reroute keep a human in the loop. | **Training plus spot checks.** Measure acceptance-without-edit rates, and audit a sample of accepted clinical routings every month. |

**In short:** administrative routing (scheduling, billing, records) can run unattended with periodic spot checks. Clinical and urgent routing always needs a human to confirm. The emergency screen is rule-based and errs toward over-escalating.

## Running locally

Prerequisites: Node 22.13+ (or 24), pnpm, and the Netlify CLI (`npm i -g netlify-cli`), logged in and linked to the site.

```bash
pnpm install
netlify link            # once, to connect to the Netlify project
netlify dev             # starts Vite + Functions + local DB + AI Gateway credentials
```

Open the URL that `netlify dev` prints. The database seeds itself on the first API call with 15 synthetic patients, 14 staff and 9 routing rules. Messages are never pre-seeded: they always go through the live pipeline. The seed data lives in `db/seed-patients.ts`, `db/seed-messages.ts` (50 sample messages) and `server/seed-staff.ts`.

Schema changes: edit `db/schema.ts`, then run `npx drizzle-kit generate --name <change>`. Netlify applies migrations on deploy.

## Accounts and keys

| What | Needed? | Where |
| --- | --- | --- |
| Netlify account | Yes | You already have one. It hosts the site, Functions, the Database and AI Gateway. |
| Anthropic API key | **No** | Netlify AI Gateway supplies Claude credentials automatically. Set `ANTHROPIC_API_KEY` only to use your own Anthropic account. |
| Resend account | Optional | https://resend.com (free). Set `RESEND_API_KEY` and `NOTIFY_EMAIL_TO` (your Resend sign-up email) in Netlify environment variables to receive emergency, escalation and daily-report emails. |

See `.env.example` for every variable.

## Data protection

This project handles protected health information (PHI). The database enforces:

- **Access control** – row-level security is enabled on every table and PUBLIC grants are revoked. Tables holding
  PHI (`patients`, `messages`, `tasks`, `notifications`, `corrections`, agent/automation/eval logs, `audit_log`) are
  not readable by the read-only troubleshooting role.
- **Staff approval of AI replies** – `messages.patient_auto_reply` is a draft. It can only be marked `sent` after a
  staff member sets `auto_reply_status = 'approved'` with `auto_reply_reviewed_by` / `auto_reply_reviewed_at`.
  Editing an approved draft sends it back to `pending_review`. A database trigger enforces this.
- **Retention** – the `purge-expired-records` scheduled function runs `purge_expired_records()` daily. Retention
  periods (days) are in the `retention_days` row of `settings`.

Never commit real patient data, exports, or seed files containing PHI to this repository. Use synthetic data for
development and evaluation.
