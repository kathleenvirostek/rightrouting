import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowRight, Bot, Inbox, ShieldAlert, Stethoscope, Timer, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useApp } from '@/lib/app-context'
import { roleLabel } from '@/lib/format'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/')({
  component: Home,
})

const PIPELINE = [
  { icon: Inbox, title: 'Message arrives', body: 'A patient sends a portal message. Automation 1 fires on the event.' },
  { icon: ShieldAlert, title: 'Red-flag screen (no AI)', body: 'Deterministic rules catch emergencies instantly: fixed 911/ER reply + on-duty RN alerted.' },
  { icon: Bot, title: 'Triage & Routing Agent', body: 'Classifies intents, checks rules, chart, staff load and past corrections, and splits multi-intent messages.' },
  { icon: Users, title: 'Right queue + SLA', body: 'Task lands with a specific person, a 1–2 sentence reason, a confidence score and an SLA timer.' },
  { icon: Stethoscope, title: 'Care Team Prep Agent', body: 'Writes a short, role-matched brief. Non-clinical staff get a simple draft reply; clinicians get key questions.' },
  { icon: Timer, title: 'SLA Watchdog', body: 'Every 15 minutes, overdue tasks go to a backup or the charge nurse, and the manager is notified.' },
]

const DEMO = [
  { label: 'Submit a refill request → Pharmacy, not the physician', to: '/portal' as const },
  { label: 'Submit a billing question → Billing', to: '/portal' as const },
  { label: 'Submit a multi-intent message → split into two tasks', to: '/portal' as const },
  { label: 'Submit a chest-pain message → emergency screen fires instantly, no AI', to: '/portal' as const },
  { label: 'Reroute one card → correction saved', to: '/dashboard' as const },
  { label: 'Run the SLA watchdog now', to: '/manager' as const },
  { label: 'Show the manager analytics', to: '/manager' as const },
]

const FAILURES = [
  { title: 'Missed emergency', body: 'Unusual wording slips past the keyword screen. Patterns favor false alarms over misses, and the eval set checks emergency recall.' },
  { title: 'Wrong route', body: 'The agent picks the wrong role. Low-confidence decisions go to Triage RN review, staff can reroute in one click, and corrections become examples for future routing.' },
  { title: 'AI outage or runaway agent', body: 'API errors or hitting the step limit send the message to the Triage RN queue instead of dropping it. Try "Simulate LLM outage" in Manager settings.' },
  { title: 'Hallucinated draft', body: 'Prep drafts exist only for admin requests, must pass a fact-check against the chart, and are never sent to the patient automatically.' },
  { title: 'Message sits unanswered', body: 'The SLA Watchdog reassigns overdue tasks to a backup or the charge nurse and alerts the manager.' },
  { title: 'Privacy and access', body: 'The Prep Agent sees only the chart sections needed for each intent. The role switcher is a demo; a real deployment needs SSO and a BAA-covered model.' },
]

const TRUST = [
  { level: 'Runs without review', body: 'Emergency screen and fixed 911/ER notice, SLA timers, escalations, daily report. These are deterministic code, not AI.' },
  { level: 'AI decides, a human can override', body: 'Routing admin requests (scheduling, billing, refills, forms) with confidence of 0.70 or higher. Staff see the reason and can reroute.' },
  { level: 'Always needs a human', body: 'Every clinical decision, every reply to a patient, symptoms and low-confidence messages. The AI only prepares a brief.' },
]

function Home() {
  const { boot, persona, setPersonaId } = useApp()
  return (
    <div className="mx-auto max-w-content px-4 py-10 sm:px-6">
      <section className="grid gap-10 lg:grid-cols-[1.3fr_1fr] lg:items-start">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wider text-primary">Concept prototype · primary care clinic, Aurora, Colorado</p>
          <h1 className="mt-3 font-display text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
            Every portal message reaches the person who can act on it.
          </h1>
          <p className="mt-4 max-w-reading text-lg text-muted-foreground">
            RightRoute classifies each incoming patient portal message, detects urgency, and routes it to the right care team role with a clear
            reason, before any reply is drafted. Physicians only get what truly needs a physician.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/portal">
                Open the patient portal simulator <ArrowRight aria-hidden />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/dashboard">Go to routing dashboard</Link>
            </Button>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <h2 className="font-semibold">The operational problem</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            At a large health system like UCHealth, an AI tool in Epic drafts portal replies. Physicians are getting more messages, and more complex
            AI-drafted ones, even though a nurse, scheduler, pharmacist or billing team could handle many of them. Physicians lose time, simple
            requests sit in the wrong inbox, and urgent messages can be delayed.
          </p>
          <h2 className="mt-4 font-semibold">Who uses RightRoute</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            The clinic care team (front desk and schedulers, medical assistants, triage RNs, pharmacists, billing staff, physicians and APPs) and the
            clinic operations manager. Patients benefit indirectly because their messages reach someone who can act sooner.
          </p>
          <p className="mt-4 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
            Humans make every clinical decision. RightRoute never gives medical advice and never sends a clinical reply on its own. The only automatic
            patient message is a fixed, pre-approved emergency notice.
          </p>
        </div>
      </section>

      <section aria-labelledby="how" className="mt-14">
        <h2 id="how" className="font-display text-2xl font-bold">
          How it works
        </h2>
        <ol className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {PIPELINE.map((p, i) => (
            <li key={p.title} className="rounded-xl border bg-card p-4">
              <div className="flex items-center gap-2">
                <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-foreground">
                  <p.icon className="size-4" aria-hidden />
                </span>
                <span className="text-xs font-semibold text-muted-foreground">Step {i + 1}</span>
              </div>
              <h3 className="mt-3 font-semibold">{p.title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{p.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="risks" className="mt-14">
        <h2 id="risks" className="font-display text-2xl font-bold">
          Where it can fail, and how much to trust it
        </h2>
        <div className="mt-5 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <ul className="grid gap-3 sm:grid-cols-2">
            {FAILURES.map((f) => (
              <li key={f.title} className="rounded-xl border bg-card p-4">
                <h3 className="font-semibold">{f.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
              </li>
            ))}
          </ul>
          <div className="rounded-xl border bg-card p-5">
            <h3 className="font-semibold">Trust without human review</h3>
            <ol className="mt-3 space-y-3">
              {TRUST.map((t) => (
                <li key={t.level} className="text-sm">
                  <span className="font-medium">{t.level}</span>
                  <p className="text-muted-foreground">{t.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className="mt-14 grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border bg-card p-5">
          <h2 className="font-display text-xl font-bold">3-minute demo path</h2>
          <ol className="mt-4 space-y-2">
            {DEMO.map((d, i) => (
              <li key={d.label} className="flex items-start gap-3 text-sm">
                <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{i + 1}</span>
                <Link to={d.to} className="pt-0.5 hover:underline">
                  {d.label}
                </Link>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-xs text-muted-foreground">Keep the Agent activity panel on the dashboard open so the audience can watch each step.</p>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <h2 className="font-display text-xl font-bold">Demo sign-in</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose who you are. Staff see their role's queue. The operations manager also gets the Manager page. This is a demo role switcher, not
            real authentication.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {!boot && Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />)}
            {boot?.staff.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setPersonaId(s.id)}
                aria-pressed={persona?.id === s.id}
                className={cn(
                  'rounded-lg border p-2.5 text-left transition-colors hover:bg-accent motion-reduce:transition-none',
                  persona?.id === s.id && 'border-primary bg-accent',
                )}
              >
                <span className="block text-sm font-medium">{s.name}</span>
                <span className="block text-xs text-muted-foreground">{roleLabel(s.role)}</span>
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
