import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { api, setApiUser } from './api'
import type { Bootstrap, Staff } from './types'

interface AppState {
  boot: Bootstrap | null
  bootError: string | null
  reloadBoot: () => Promise<void>
  persona: Staff | null
  setPersonaId: (id: string) => void
  isManager: boolean
}

const AppContext = createContext<AppState | null>(null)
const STORAGE_KEY = 'rightroute.persona'

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [boot, setBoot] = useState<Bootstrap | null>(null)
  const [bootError, setBootError] = useState<string | null>(null)
  const [personaId, setPersonaIdState] = useState('S05')

  const reloadBoot = async () => {
    try {
      setBoot(await api<Bootstrap>('/bootstrap'))
      setBootError(null)
    } catch (e) {
      setBootError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      setPersonaIdState(saved)
      setApiUser(saved)
    }
    reloadBoot()
  }, [])

  const setPersonaId = (id: string) => {
    localStorage.setItem(STORAGE_KEY, id)
    setApiUser(id)
    setPersonaIdState(id)
  }

  const value = useMemo<AppState>(() => {
    const persona = boot?.staff.find((s) => s.id === personaId) ?? null
    return { boot, bootError, reloadBoot, persona, setPersonaId, isManager: persona?.role === 'manager' }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot, bootError, personaId])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}
