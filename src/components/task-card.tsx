import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { AlertTriangle, Check, CornerUpRight, Split, User } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { ConfidenceMeter, RolePill, SlaTimer, UrgencyBadge } from '@/components/badges'
import { api } from '@/lib/api'
import { intentLabel, roleLabel, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Task } from '@/lib/types'
import { ROLES } from '@shared/domain'

const ROUTED_BY: Record<string, string> = {
  safety_screen: 'Rule-based safety screen (no AI)',
  agent: 'Triage & Routing Agent',
  fallback: 'Fallback (AI unavailable)',
  reroute: 'Rerouted by staff',
}

export function TaskCard({ task, onChange }: { task: Task; onChange: () => void }) {
  const [rerouteOpen, setRerouteOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const accepted = task.status === 'accepted'

  const accept = async () => {
    setBusy(true)
    try {
      await api(`/tasks/${task.id}/accept`, { method: 'POST', body: {} })
      toast.success(`Task #${task.id} accepted — SLA timer stopped`)
      onChange()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not accept')
    } finally {
      setBusy(false)
    }
  }

  return (
    <article
      className={cn(
        'rounded-xl border bg-card p-4 shadow-xs transition-colors motion-reduce:transition-none',
        task.urgency === 'emergency' && !accepted && 'border-urgency-emergency/60 ring-2 ring-urgency-emergency/20',
        accepted && 'opacity-70',
      )}
      aria-labelledby={`task-${task.id}-title`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <UrgencyBadge urgency={task.urgency} />
        <span className="text-xs font-medium">{intentLabel(task.intent)}</span>
        {task.splitFrom && (
          <span className="inline-flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-[11px] text-accent-foreground" title="This message was split into several tasks">
            <Split className="size-3" aria-hidden /> 1 of {task.splitFrom}
          </span>
        )}
        {task.escalationCount > 0 && (
          <span className="rounded bg-urgency-urgent/15 px-1.5 py-0.5 text-[11px] font-medium text-urgency-urgent">Escalated ×{task.escalationCount}</span>
        )}
        <span className="ml-auto">
          <SlaTimer dueAt={task.slaDueAt} done={accepted} />
        </span>
      </div>

      <h3 id={`task-${task.id}-title`} className="mt-2 font-semibold leading-snug">
        <Link to="/messages/$messageId" params={{ messageId: String(task.messageId) }} className="hover:underline">
          {task.subject}
        </Link>
      </h3>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {task.patientName} · msg #{task.messageId} · task #{task.id} · {timeAgo(task.createdAt)}
      </p>
      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">“{task.excerpt || task.body}”</p>

      <div className="mt-3 rounded-lg bg-muted/60 p-3">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <RolePill role={task.assignedRole} />
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <User className="size-3" aria-hidden /> {task.assignedName ?? 'Role queue'}
          </span>
          <span className="ml-auto">
            <ConfidenceMeter value={task.confidence} />
          </span>
        </div>
        <p className="mt-2 text-sm">{task.reason}</p>
        {task.needsReview && task.reviewNote && (
          <p className="mt-2 flex gap-1.5 text-xs text-urgency-urgent">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> Needs review: {task.reviewNote}
          </p>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">Routed by: {ROUTED_BY[task.routedBy]}</p>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={accept} disabled={busy || accepted}>
          <Check aria-hidden /> {accepted ? 'Accepted' : 'Accept'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setRerouteOpen(true)} disabled={busy || accepted}>
          <CornerUpRight aria-hidden /> Reroute
        </Button>
        <Button size="sm" variant="ghost" asChild className="ml-auto">
          <Link to="/messages/$messageId" params={{ messageId: String(task.messageId) }}>
            {task.prepStatus === 'done' ? 'Open prep brief' : task.prepStatus === 'running' || task.prepStatus === 'pending' ? 'Prep brief in progress…' : 'Details'}
          </Link>
        </Button>
      </div>
      <RerouteDialog task={task} open={rerouteOpen} onOpenChange={setRerouteOpen} onDone={onChange} />
    </article>
  )
}

export function RerouteDialog({
  task,
  open,
  onOpenChange,
  onDone,
}: {
  task: Task
  open: boolean
  onOpenChange: (o: boolean) => void
  onDone: () => void
}) {
  const [role, setRole] = useState<string>('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!role) return
    setSaving(true)
    try {
      await api(`/tasks/${task.id}/reroute`, { method: 'POST', body: { toRole: role, reason } })
      toast.success(`Rerouted to ${roleLabel(role)}. Correction saved — the agent will learn from it.`)
      onOpenChange(false)
      setRole('')
      setReason('')
      onDone()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not reroute')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reroute task #{task.id}</DialogTitle>
          <DialogDescription>
            Currently with {roleLabel(task.assignedRole)}. Your correction is saved as a labeled example, and the Triage & Routing Agent uses
            similar corrections as examples for future messages.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend className="mb-1 text-sm font-medium">Correct role</legend>
          <RadioGroup value={role} onValueChange={setRole} className="grid grid-cols-2 gap-2">
            {ROLES.filter((r) => r !== task.assignedRole).map((r) => (
              <Label key={r} htmlFor={`rr-${task.id}-${r}`} className="flex cursor-pointer items-center gap-2 rounded-md border p-2.5 font-normal has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent">
                <RadioGroupItem id={`rr-${task.id}-${r}`} value={r} />
                {roleLabel(r)}
              </Label>
            ))}
          </RadioGroup>
        </fieldset>
        <div className="space-y-1.5">
          <Label htmlFor={`rr-reason-${task.id}`}>Reason (optional, helps the agent learn)</Label>
          <Textarea
            id={`rr-reason-${task.id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Our MAs handle referral status questions, not the physician."
            maxLength={500}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!role || saving}>
            {saving ? 'Saving…' : 'Reroute & save correction'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
