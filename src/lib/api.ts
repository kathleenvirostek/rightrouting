// Thin fetch wrapper for the RightRoute API (Netlify Functions under /api).
// The demo persona is sent as a header so the server can apply role-based views.

let currentUser = 'S05'
export function setApiUser(id: string) {
  currentUser = id
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? (init?.body ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', 'x-demo-user': currentUser },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`)
  return data as T
}
