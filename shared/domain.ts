// Shared domain vocabulary used by the agents, automations, database and UI.

export const ROLES = [
  'front_desk',
  'ma',
  'triage_rn',
  'pharmacy',
  'billing',
  'physician',
] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  front_desk: 'Front Desk',
  ma: 'Medical Assistant',
  triage_rn: 'Triage RN',
  pharmacy: 'Pharmacy',
  billing: 'Billing',
  physician: 'Physician / APP',
}

// Roles that are allowed to see clinical chart details and handle clinical items.
export const CLINICAL_ROLES: Role[] = ['ma', 'triage_rn', 'pharmacy', 'physician']

export const INTENTS = [
  'medication_refill',
  'scheduling',
  'billing_insurance',
  'lab_result_question',
  'symptom',
  'forms_records',
  'referral',
  'general_question',
] as const
export type Intent = (typeof INTENTS)[number]

export const INTENT_LABELS: Record<Intent, string> = {
  medication_refill: 'Medication refill',
  scheduling: 'Scheduling',
  billing_insurance: 'Billing / insurance',
  lab_result_question: 'Lab / result question',
  symptom: 'New or worsening symptom',
  forms_records: 'Forms / records',
  referral: 'Referral',
  general_question: 'General question',
}

// Administrative intents get the 2-business-day SLA; everything else is clinical.
export const ADMIN_INTENTS: Intent[] = [
  'scheduling',
  'billing_insurance',
  'forms_records',
]

export const URGENCIES = ['routine', 'same_day', 'urgent', 'emergency'] as const
export type Urgency = (typeof URGENCIES)[number]

export const URGENCY_LABELS: Record<Urgency, string> = {
  routine: 'Routine',
  same_day: 'Same-day',
  urgent: 'Urgent',
  emergency: 'Emergency',
}

// The message type a patient picks in a typical portal. Used to compute the
// "before RightRoute" baseline: legacy routing sends these straight to a pool.
export const PORTAL_TYPES = [
  'medical_question',
  'prescription_renewal',
  'appointment',
  'billing',
] as const
export type PortalType = (typeof PORTAL_TYPES)[number]

export const PORTAL_TYPE_LABELS: Record<PortalType, string> = {
  medical_question: 'Medical advice question',
  prescription_renewal: 'Prescription renewal',
  appointment: 'Appointment request',
  billing: 'Billing question',
}

// Legacy routing (before RightRoute): medical questions and renewals land in
// the PCP's inbox; appointments go to the front desk; billing to billing.
export const LEGACY_ROUTE: Record<PortalType, Role> = {
  medical_question: 'physician',
  prescription_renewal: 'physician',
  appointment: 'front_desk',
  billing: 'billing',
}

export interface Medication {
  name: string
  dose: string
  sig: string
  lastFill: string
  refillsRemaining: number
  controlled: boolean
  prescriberId: string
}

export interface Visit {
  date: string
  type: string
  providerId: string
  summary: string
}

export interface Lab {
  date: string
  name: string
  result: string
  flag: 'normal' | 'high' | 'low' | 'critical'
  resultedToPatient: boolean
}

export interface Order {
  date: string
  type: 'lab' | 'imaging' | 'referral' | 'procedure'
  description: string
  status: 'open' | 'scheduled' | 'completed'
}

export interface Chart {
  problems: string[]
  allergies: string[]
  medications: Medication[]
  visits: Visit[]
  labs: Lab[]
  orders: Order[]
  insurance: { plan: string; memberId: string; balanceDue: number }
  nextAppointment: string | null
}

export interface SampleMessage {
  key: string
  patientId: string
  portalType: PortalType
  subject: string
  body: string
  // Short tag for the demo picker, e.g. "refill", "multi-intent", "red flag".
  tag: string
}

export interface EvalCase {
  key: string
  patientId: string
  portalType: PortalType
  subject: string
  body: string
  expectedRoles: Role[] // one per expected task; order-insensitive
  expectEmergency: boolean
  note: string
}

export interface RoutedTaskDecision {
  intent: Intent
  urgency: Urgency
  role: Role
  staffId: string | null
  reason: string
  confidence: number
  excerpt: string
  needsReview: boolean
  reviewNote: string | null
}

export interface AgentStepView {
  id: number
  runId: number
  stepNo: number
  kind: string
  title: string
  detail: unknown
  createdAt: string
}
