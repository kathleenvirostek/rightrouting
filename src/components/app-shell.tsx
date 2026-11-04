import { Link } from '@tanstack/react-router'
import { Bell, ShieldAlert, Waypoints } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useApp } from '@/lib/app-context'
import { usePoll } from '@/lib/use-poll'
import { api } from '@/lib/api'
import { roleLabel, timeAgo } from '@/lib/format'

const NAV = [
  { to: '/', label: 'Overview' },
  { to: '/portal', label: 'Patient Portal' },
  { to: '/dashboard', label: 'Routing Dashboard' },
  { to: '/manager', label: 'Manager' },
  { to: '/evaluate', label: 'Evaluate' },
] as const

export function DisclaimerBanner() {
  return (
    <div role="note" className="bg-foreground px-4 py-1.5 text-center text-xs font-medium text-background sm:text-sm">
      <ShieldAlert className="mr-1.5 inline size-4 align-[-3px]" aria-hidden />
      Concept prototype — synthetic data — not affiliated with or endorsed by UCHealth or Epic.
    </div>
  )
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <DisclaimerBanner />
      <header className="sticky top-0 z-30 border-b bg-card/95 backdrop-blur">
        <div className="mx-auto flex max-w-content flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2 font-display text-lg font-bold tracking-tight">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Waypoints className="size-4.5" aria-hidden />
            </span>
            RightRoute
          </Link>
          <nav aria-label="Main" className="order-3 flex w-full gap-1 overflow-x-auto md:order-none md:w-auto">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground motion-reduce:transition-none"
                activeProps={{ className: 'bg-accent !text-foreground font-semibold' }}
                activeOptions={{ exact: n.to === '/' }}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Notifications />
            <PersonaSwitcher />
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        RightRoute is a student capstone concept (CU Boulder AI Club Applied AI Development Program). All patients, staff and messages are
        fictional. The system never gives medical advice or sends clinical replies on its own.
      </footer>
    </div>
  )
}

export function PersonaSwitcher() {
  const { boot, persona, setPersonaId } = useApp()
  if (!boot) return <div className="h-9 w-52 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
  const groups = new Map<string, typeof boot.staff>()
  for (const s of boot.staff) groups.set(s.role, [...(groups.get(s.role) ?? []), s])
  return (
    <Select value={persona?.id} onValueChange={setPersonaId}>
      <SelectTrigger className="w-56" aria-label="Signed in as (demo role switcher)">
        <SelectValue placeholder="Sign in as…" />
      </SelectTrigger>
      <SelectContent>
        {[...groups.entries()].map(([role, people]) => (
          <SelectGroup key={role}>
            <SelectLabel>{roleLabel(role)}</SelectLabel>
            {people.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
      </SelectContent>
    </Select>
  )
}

interface Notification {
  id: number
  kind: string
  title: string
  body: string
  channel: string
  emailStatus: string | null
  createdAt: string
}

function Notifications() {
  const { persona } = useApp()
  const { data } = usePoll(
    () => (persona ? api<Notification[]>(`/notifications?staffId=${persona.id}`) : Promise.resolve([])),
    8000,
    [persona?.id],
  )
  const items = data ?? []
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Notifications (${items.length})`} className="relative">
          <Bell className="size-4.5" />
          {items.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              {items.length > 9 ? '9+' : items.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="border-b px-4 py-2.5 text-sm font-semibold">Notifications for {persona?.name ?? '…'}</div>
        <ul className="max-h-96 divide-y overflow-y-auto">
          {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted-foreground">No notifications yet.</li>}
          {items.map((n) => (
            <li key={n.id} className="px-4 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className={`text-sm font-medium ${n.kind === 'emergency' ? 'text-urgency-emergency' : ''}`}>{n.title}</p>
                <span className="shrink-0 text-[11px] text-muted-foreground">{timeAgo(n.createdAt)}</span>
              </div>
              <p className="mt-0.5 line-clamp-3 whitespace-pre-line text-xs text-muted-foreground">{n.body}</p>
              {n.channel === 'email' && <p className="mt-1 text-[11px] text-muted-foreground">Email: {n.emailStatus}</p>}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
