import { useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import { AlertTriangle, Layers, Loader2, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AgentActivityPanel } from '@/components/agent-activity'
import { RolePill, UrgencyBadge } from '@/components/badges'
import { useApp } from '@/lib/app-context'
import { api } from '@/lib/api'
import { usePoll } from '@/lib/use-poll'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { PORTAL_TYPES, PORTAL_TYPE_LABELS, type PortalType, type SampleMessage } from '@shared/domain'

export const Route = createFileRoute('/portal')({
  head: () => ({ meta: [{ title: 'Patient Portal Simulator · RightRoute' }] }),
  component: PortalPage,
})

interface RecentMessage {
  id: number
  patientId: string
  patientName?: string
  subject: string
  body: string
  status: string
  isEmergency: boolean
  patientAutoReply: string | null
  createdAt: string
  tasks: { id: number; role: string; intent: string; urgency: string; assignedName: string | null }[]
}

const DEMO_KEYS = [
  { key: 'm01', label: 'Refill request' },
  { key: 'm02', label: 'Billing question' },
  { key: 'm03', label: 'Multi-intent' },
  { key: 'm04', label: 'Chest pain' },
]

function PortalPage() {
  const { boot } = useApp()
  const [patientId, setPatientId] = useState('')
  const [portalType, setPortalType] = useState<PortalType>('medical_question')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [loading25, setLoading25] = useState(false)
  const [tagFilter, setTagFilter] = useState('all')
  const recent = usePoll(() => api<RecentMessage[]>('/messages'), 3000)

  const loadSample = (s: SampleMessage) => {
    setPatientId(s.patientId)
    setPortalType(s.portalType)
    setSubject(s.subject)
    setBody(s.body)
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!patientId || !body.trim()) {
      toast.error('Choose a patient and write a message')
      return
    }
    setSending(true)
    try {
      const r = await api<{ messageId: number; emergency: boolean; redFlags: { category: string }[] }>('/messages', {
        body: { patientId, portalType, subject, body },
      })
      if (r.emergency) toast.error(`Emergency screen fired (${r.redFlags.map((f) => f.category).join(', ')}). Triage RN alerted. No AI used.`, { duration: 8000 })
      else toast.success(`Message #${r.messageId} received. Triage & Routing Agent is working…`)
      setSubject('')
      setBody('')
      recent.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send')
    } finally {
      setSending(false)
    }
  }

  const load25 = async () => {
    setLoading25(true)
    try {
      const r = await api<{ loaded: number; emergencies: number }>('/demo/load-samples', { body: { count: 25 } })
      toast.success(`Loaded ${r.loaded} sample messages (${r.emergencies} caught by the emergency screen). The agents are routing the rest now.`)
      recent.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load samples')
    } finally {
      setLoading25(false)
    }
  }

  const samples = boot?.samples ?? []
  const tags = ['all', ...new Set(samples.map((s) => s.tag))]
  const filtered = samples.filter((s) => tagFilter === 'all' || s.tag === tagFilter)
  const patientName = (id: string) => boot?.patients.find((p) => p.id === id)?.name ?? id

  return (
    <div className="mx-auto grid max-w-content gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[1fr_400px]">
      <div className="min-w-0 space-y-6">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight">Patient Portal Simulator</h1>
          <p className="mt-1 text-muted-foreground">
            Send a message as a synthetic patient. It goes through the same live pipeline a real message would: safety screen first, then the AI
            agents.
          </p>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Demo messages:</span>
            {DEMO_KEYS.map((d) => {
              const s = samples.find((x) => x.key === d.key)
              return (
                <Button key={d.key} size="sm" variant="secondary" disabled={!s} onClick={() => s && loadSample(s)}>
                  {d.label}
                </Button>
              )
            })}
            <Button size="sm" variant="outline" className="ml-auto" onClick={load25} disabled={loading25}>
              {loading25 ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Layers aria-hidden />}
              Load 25 sample messages
            </Button>
          </div>

          <form onSubmit={submit} className="mt-5 grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="patient">Patient (synthetic)</Label>
                <Select value={patientId} onValueChange={setPatientId}>
                  <SelectTrigger id="patient" className="w-full">
                    <SelectValue placeholder="Choose a patient" />
                  </SelectTrigger>
                  <SelectContent>
                    {boot?.patients.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} · {p.age}{p.sex} · PCP {p.pcp}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ptype">Message type (as the patient picks it)</Label>
                <Select value={portalType} onValueChange={(v) => setPortalType(v as PortalType)}>
                  <SelectTrigger id="ptype" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PORTAL_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {PORTAL_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="subject">Subject</Label>
              <Input id="subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={140} placeholder="e.g. Refill please" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="body">Message</Label>
              <Textarea id="body" value={body} onChange={(e) => setBody(e.target.value)} rows={5} maxLength={4000} placeholder="Type a message or pick a sample below" />
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={sending}>
                {sending ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Send aria-hidden />}
                Send message
              </Button>
              <p className="text-xs text-muted-foreground">Portal messages are not for emergencies. Call 911 in an emergency.</p>
            </div>
          </form>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">Sample library ({samples.length})</h2>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filter samples by type">
              {tags.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTagFilter(t)}
                  aria-pressed={tagFilter === t}
                  className={cn('rounded-full border px-2.5 py-0.5 text-xs', tagFilter === t ? 'border-primary bg-accent font-medium' : 'text-muted-foreground hover:bg-muted')}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
          <ul className="mt-3 grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2">
            {filtered.map((s) => (
              <li key={s.key}>
                <button type="button" onClick={() => loadSample(s)} className="w-full rounded-lg border p-2.5 text-left hover:bg-accent">
                  <span className="flex items-center gap-2">
                    <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', s.tag === 'red flag' ? 'bg-urgency-emergency text-white' : 'bg-muted text-muted-foreground')}>{s.tag}</span>
                    <span className="truncate text-sm font-medium">{s.subject}</span>
                  </span>
                  <span className="mt-1 line-clamp-2 block text-xs text-muted-foreground">{s.body}</span>
                  <span className="mt-1 block text-[11px] text-muted-foreground">{patientName(s.patientId)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Recently received messages</h2>
          {recent.loading && <div className="mt-3 h-20 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />}
          {recent.error && <p className="mt-3 text-sm text-destructive">{recent.error}</p>}
          {recent.data?.length === 0 && <p className="mt-3 text-sm text-muted-foreground">No messages yet. Send one above.</p>}
          <ul className="mt-3 divide-y">
            {recent.data?.map((m) => (
              <li key={m.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to="/messages/$messageId" params={{ messageId: String(m.id) }} className="font-medium hover:underline">
                    #{m.id} {m.subject}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {m.patientName} · {timeAgo(m.createdAt)}
                  </span>
                  <StatusChip status={m.status} />
                </div>
                {m.isEmergency && m.patientAutoReply && (
                  <div className="mt-2 flex gap-2 rounded-lg border border-urgency-emergency/40 bg-urgency-emergency/5 p-3 text-sm">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-urgency-emergency" aria-hidden />
                    <div>
                      <p className="text-xs font-semibold text-urgency-emergency">Automatic reply sent to patient (fixed, pre-approved template — not AI)</p>
                      <p className="mt-1">{m.patientAutoReply}</p>
                    </div>
                  </div>
                )}
                {m.tasks.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">Routed to:</span>
                    {m.tasks.map((t) => (
                      <span key={t.id} className="inline-flex items-center gap-1">
                        <RolePill role={t.role} />
                        <span className="text-xs">{t.assignedName ?? 'Role queue'}</span>
                        <UrgencyBadge urgency={t.urgency} />
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <AgentActivityPanel className="h-[calc(100vh-9rem)] lg:sticky lg:top-24" />
    </div>
  )
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    received: ['Received', 'bg-muted text-muted-foreground'],
    routing: ['Agent routing…', 'bg-accent text-accent-foreground animate-pulse motion-reduce:animate-none'],
    routed: ['Routed', 'bg-secondary text-secondary-foreground'],
    emergency: ['Emergency screen', 'bg-urgency-emergency text-white'],
    failed: ['Failed — check logs', 'bg-destructive text-white'],
  }
  const [label, cls] = map[status] ?? [status, 'bg-muted']
  return <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', cls)}>{label}</span>
}
