import type { Chart, Role, SampleMessage } from '@shared/domain'

export interface Staff {
  id: string
  name: string
  role: Role | 'manager'
  title: string
  email: string
  pod: string | null
  available: boolean
  onDuty: boolean
  isChargeNurse: boolean
  backupId: string | null
  shift: string
}

export interface PatientLite {
  id: string
  name: string
  age: number
  sex: string
  mrn: string
  pcp?: string
}

export interface Settings {
  confidence_threshold: number
  sla_emergency_minutes: number
  sla_urgent_minutes: number
  simulate_llm_outage: boolean
  email_new_tasks: boolean
}

export interface Bootstrap {
  patients: PatientLite[]
  staff: Staff[]
  samples: SampleMessage[]
  settings: Settings
  redFlagCategories: string[]
  emergencyTemplate: string
  evalSetSize: number
}

export interface PrepBrief {
  mode: 'reply' | 'clinician_summary'
  brief: string[]
  keyQuestions: string[]
  protocolFlags: string[]
  suggestedReply: string | null
  replyNote?: string | null
  readingGrade: number | null
  wordCount: number | null
  selfCheck: { passed: boolean; attempts: number; issues: string[] }
  sectionsUsed: string[]
}

export interface Task {
  id: number
  messageId: number
  intent: string
  urgency: string
  assignedRole: Role
  assignedStaffId: string | null
  assignedName: string | null
  originalRole: string
  reason: string
  confidence: number
  excerpt: string
  routedBy: 'safety_screen' | 'agent' | 'fallback' | 'reroute'
  needsReview: boolean
  reviewNote: string | null
  status: 'open' | 'accepted'
  priority: number
  slaDueAt: string
  acknowledgedAt: string | null
  escalationCount: number
  prepStatus: string
  prepBrief: PrepBrief | null
  createdAt: string
  patientName?: string
  patientId?: string
  subject?: string
  body?: string
  isEmergency?: boolean
  splitFrom?: number | null
}

export interface AgentStep {
  id: number
  runId: number
  stepNo: number
  kind: string
  title: string
  detail: unknown
  createdAt: string
  agent?: string
  messageId?: number | null
  taskId?: number | null
  evalRunId?: number | null
}

export interface AutomationRun {
  id: number
  automation: 'safety_screen' | 'sla_watchdog' | 'daily_report'
  trigger: string
  status: string
  messageId: number | null
  steps: { name: string; status: string; detail: string; at: string }[]
  summary: string | null
  startedAt: string
  finishedAt: string | null
}

export type { Chart }
