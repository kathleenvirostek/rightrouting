import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Inbox } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { AgentActivityPanel } from '@/components/agent-activity'
import { TaskCard } from '@/components/task-card'
import { useApp } from '@/lib/app-context'
import { api } from '@/lib/api'
import { usePoll } from '@/lib/use-poll'
import { roleLabel } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Task } from '@/lib/types'
import { ROLES, type Role } from '@shared/domain'

export const Route = createFileRoute('/dashboard')({
  head: () => ({ meta: [{ title: 'Routing Dashboard · RightRoute' }] }),
  component: Dashboard,
})

type Queue = Role | 'all' | 'review'

function Dashboard() {
  const { persona } = useApp()
  const [queue, setQueue] = useState<Queue>('all')
  const [showDone, setShowDone] = useState(false)
  const { data, error, loading, refresh } = usePoll(() => api<Task[]>('/tasks'), 4000)

  // Open the signed-in person's own queue by default.
  useEffect(() => {
    if (persona && ROLES.includes(persona.role as Role)) setQueue(persona.role as Role)
  }, [persona?.id])

  const tasks = data ?? []
  const open = tasks.filter((t) => t.status === 'open')
  const count = (q: Queue) =>
    q === 'all' ? open.length : q === 'review' ? open.filter((t) => t.needsReview).length : open.filter((t) => t.assignedRole === q).length
  const visible = tasks
    .filter((t) => showDone || t.status === 'open')
    .filter((t) => (queue === 'all' ? true : queue === 'review' ? t.needsReview : t.assignedRole === queue))

  const queues: Queue[] = ['all', ...ROLES, 'review']

  return (
    <div className="mx-auto grid max-w-content gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[1fr_380px]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight">Routing Dashboard</h1>
            <p className="mt-1 text-muted-foreground">
              Care team queues. Accept a task to stop its SLA timer, or reroute it. Every reroute teaches the agent.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="show-done" checked={showDone} onCheckedChange={setShowDone} />
            <Label htmlFor="show-done" className="text-sm">
              Show accepted
            </Label>
          </div>
        </div>

        <div className="mt-5 flex gap-1 overflow-x-auto rounded-lg bg-muted p-1" role="tablist" aria-label="Queues">
          {queues.map((q) => (
            <button
              key={q}
              role="tab"
              aria-selected={queue === q}
              onClick={() => setQueue(q)}
              className={cn(
                'flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors motion-reduce:transition-none',
                queue === q ? 'bg-card font-semibold shadow-xs' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {q === 'all' ? 'All queues' : q === 'review' ? 'Needs review' : roleLabel(q)}
              <span className={cn('rounded-full px-1.5 text-xs tabular-nums', queue === q ? 'bg-primary text-primary-foreground' : 'bg-background')}>{count(q)}</span>
            </button>
          ))}
        </div>

        {error && <p className="mt-6 text-sm text-destructive">Could not load tasks: {error}</p>}
        {loading && (
          <div className="mt-5 grid gap-4 xl:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-64 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
            ))}
          </div>
        )}
        {!loading && visible.length === 0 && (
          <div className="mt-10 flex flex-col items-center rounded-xl border border-dashed p-10 text-center">
            <Inbox className="size-8 text-muted-foreground" aria-hidden />
            <p className="mt-3 font-medium">This queue is empty</p>
            <p className="mt-1 text-sm text-muted-foreground">Send a message from the Patient Portal Simulator, or load the 25 sample messages.</p>
          </div>
        )}
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          {visible.map((t) => (
            <TaskCard key={t.id} task={t} onChange={refresh} />
          ))}
        </div>
      </div>
      <AgentActivityPanel className="h-[calc(100vh-9rem)] lg:sticky lg:top-24" />
    </div>
  )
}
