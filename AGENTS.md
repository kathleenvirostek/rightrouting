# AGENTS.md

Guidance for AI agents and developers working on **RightRoute**, a concept prototype that routes patient portal messages to the right primary-care role. The scenario is a UCHealth clinic in Aurora, CO. All data is synthetic, and the product is not affiliated with UCHealth or Epic. The disclaimer banner in `src/components/app-shell.tsx` must always stay visible.

## Architecture

- **Frontend:** TanStack Start (React 19 + Vite + Tailwind 4), with file routes in `src/routes/`. Pages fetch data client-side from `/api/*` using `src/lib/api.ts` and poll with `src/lib/use-poll.ts`. There are no TanStack server functions; all server logic lives in Netlify Functions.
- **API:** `netlify/functions/api.mts` is one function on `/api/*` with a tiny segment router (no URLPattern, for runtime portability). User functions take precedence over the framework's SSR catch-all.
- **Background functions:**
  - `process-messages.mts` runs Automation 1 steps 2–4 (Triage Agent → tasks → SLA → notify), then the Prep Agent for each task. It also re-runs prep after a reroute.
  - `run-eval.mts` runs the 30-case evaluation.
  - Both check the `x-internal-token` header against a random token stored in the `settings` table (`server/internal.ts`).
- **Scheduled function:** `sla-watchdog.mts` (`*/15 * * * *`) runs Automation 2. "Run now" calls the same `runSlaWatchdog()` from the API.
- **Server logic** lives in `server/`:
  - `llm.ts`: the Anthropic client, the generic `runToolLoop` (agent engine with a step limit and per-step logging to `agent_steps`) and `structuredCall` (forced-tool JSON output).
  - `agents/triage.ts`: Agent 1, its tools and its post-decision guardrails.
  - `agents/prep.ts`: Agent 2, with minimum-necessary chart access, the refill protocol and the `check_draft` self-check.
  - `pipeline.ts`: Automation 1 (`receiveMessage` runs synchronously and handles emergencies with no AI; `routeMessage` and `processMessages` run in the background).
  - `watchdog.ts`: Automation 2 and the daily report.
  - `red-flags.ts`: the deterministic emergency screen and the fixed patient template.
  - `sla.ts`: SLA computation in America/Denver business hours.
  - `similarity.ts`: TF-IDF retrieval of past corrections.
  - `analytics.ts`, `eval.ts`, `events.ts` (audit, notifications, Resend email, automation run log), `seed.ts`, `seed-staff.ts`, `settings.ts`, `clinic.ts` (patient, staff directory, assignee picking).
- **Database:** Netlify Database with Drizzle. The schema is in `db/schema.ts` and the client in `db/index.ts`. Migrations are in `netlify/database/migrations/` and are generated with `npx drizzle-kit generate --name <name>`. Never hand-edit applied migrations, and never run migrate/push.
- **Shared vocabulary:** `shared/domain.ts` defines roles, intents, urgencies, portal types and the legacy-routing baseline. `shared/eval-set.ts` holds the 30 labeled test cases. Import them in the frontend with `@shared/*`.

## Key directories

```
db/                     schema, client, synthetic patients (seed-patients.ts), 50 sample messages (seed-messages.ts)
server/                 agents, automations, helpers (imported only by functions)
netlify/functions/      api, process-messages (bg), run-eval (bg), sla-watchdog (scheduled)
shared/                 domain types/constants + eval set (used by both sides)
src/routes/             index (overview + demo sign-in), portal, dashboard, messages.$messageId, manager, evaluate
src/components/         app-shell (banner/nav/role switcher/notifications), agent-activity, task-card, badges, ui/
```

## Non-obvious decisions

- **The emergency screen is regex, not AI, and runs synchronously** in `POST /api/messages` so it fires instantly. It must keep 100% recall on both the sample library and the eval set. After editing patterns, re-check every `tag: 'red flag'` sample and every `expectEmergency` case. False positives are acceptable; misses are not.
- **The patient never receives AI text.** The only automatic patient message is `EMERGENCY_TEMPLATE`. Drafted replies exist only in the prep brief, are only for admin intents, and are never sent.
- **Guardrails are code, not prompt.**
  - The `submit_routing_decision` tool throws `ToolInputError` if rules weren't checked or a staff ID doesn't match the role. The model sees the error and retries.
  - `applyGuardrails` enforces the confidence threshold, sends emergencies and symptoms to clinical roles, and handles staff availability.
  - The Prep submit tool refuses a reply for clinical intents and requires `check_draft` to have passed on the exact reply text.
- **Fallback:** any LLM error, the `simulate_llm_outage` setting or hitting the step limit makes the triage agent return one Triage RN task with `routedBy: 'fallback'`.
- **Learning** is retrieval of `corrections` rows used as few-shot examples, not fine-tuning. The reroute rate is charted per batch of 10 AI-routed tasks.
- **"Before vs. after" physician %:** "before" = messages whose patient-chosen portal type legacy routing sends to the PCP (`LEGACY_ROUTE`); "after" = tasks actually assigned to physicians.
- **Seeding:** `ensureSeeded()` runs on the first API call against an empty DB. Messages are never seeded, so every routing decision comes from the live agents. Manager → Settings → Reset truncates the operational tables and keeps `internal_token`.
- **The demo role switcher** sends `x-demo-user`. Manager-only endpoints check that the role is `manager`. This is not real authentication; a real deployment needs SSO.
- **Email** goes through Resend only when `RESEND_API_KEY` and `NOTIFY_EMAIL_TO` are set. All fictional staff share that one inbox. Emergencies, urgent tasks and escalations email; routine new tasks don't unless the `email_new_tasks` setting is on.
- **Models:** `claude-sonnet-5-5` drives the agent loops, and `claude-haiku-5-5` does `classify_message` and the fact-check in `check_draft`. Only use models listed in the Netlify AI Gateway docs.

## Conventions

- TypeScript strict. Server code uses relative, extensionless imports (no `@/` aliases), because functions are bundled by esbuild.
- Use theme variables from `src/styles.css`, including the `urgency-*` colors. Don't use raw Tailwind colors.
- Read environment variables with `Netlify.env.get()` in server code.
- Every new automation step should call `logAutomationStep`, and every agent action should go through `logStep`, so the demo panel stays complete.
- Don't run build, typecheck or dev commands in agent sessions; the deploy pipeline validates them.
