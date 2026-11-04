// Synthetic clinic staff, default routing rules and settings for the demo clinic.
export interface SeedStaff {
  id: string
  name: string
  role: string
  title: string
  pod: string | null
  isChargeNurse?: boolean
  backupId: string | null
  shift: string
}

export const SEED_STAFF: SeedStaff[] = [
  { id: 'S01', name: 'Dana Whitaker', role: 'front_desk', title: 'Scheduler', pod: null, backupId: 'S02', shift: '7:30–16:00' },
  { id: 'S02', name: 'Luis Ortega', role: 'front_desk', title: 'Patient Services Rep', pod: null, backupId: 'S01', shift: '9:00–17:30' },
  { id: 'S03', name: 'Priya Natarajan', role: 'ma', title: 'Medical Assistant (Pod A)', pod: 'A', backupId: 'S04', shift: '8:00–16:30' },
  { id: 'S04', name: 'Marcus Bell', role: 'ma', title: 'Medical Assistant (Pod B)', pod: 'B', backupId: 'S03', shift: '8:00–16:30' },
  { id: 'S05', name: 'Hannah Moreau, RN', role: 'triage_rn', title: 'Triage RN', pod: null, backupId: 'S06', shift: '7:00–17:00' },
  { id: 'S06', name: 'Jordan Ellis, RN', role: 'triage_rn', title: 'Charge Nurse', pod: null, isChargeNurse: true, backupId: 'S05', shift: '7:00–17:00' },
  { id: 'S07', name: 'Grace Kim, PharmD', role: 'pharmacy', title: 'Clinical Pharmacist', pod: null, backupId: 'S08', shift: '8:00–17:00' },
  { id: 'S08', name: 'Tomás Reyes, CPhT', role: 'pharmacy', title: 'Pharmacy Technician', pod: null, backupId: 'S07', shift: '8:00–16:30' },
  { id: 'S09', name: 'Aisha Rahman', role: 'billing', title: 'Billing Specialist', pod: null, backupId: 'S10', shift: '8:00–16:30' },
  { id: 'S10', name: 'Ben Carter', role: 'billing', title: 'Insurance & Prior Auth', pod: null, backupId: 'S09', shift: '8:30–17:00' },
  { id: 'S11', name: 'Dr. Emily Chen, MD', role: 'physician', title: 'Family Medicine (Pod A PCP)', pod: 'A', backupId: 'S12', shift: '8:00–17:00' },
  { id: 'S12', name: 'Dr. Samuel Okafor, MD', role: 'physician', title: 'Internal Medicine (Pod B PCP)', pod: 'B', backupId: 'S11', shift: '8:00–17:00' },
  { id: 'S13', name: 'Maya Rivera, NP', role: 'physician', title: 'Nurse Practitioner (Pod B APP)', pod: 'B', backupId: 'S12', shift: '8:00–17:00' },
  { id: 'S14', name: 'Nicole Brandt', role: 'manager', title: 'Clinic Operations Manager', pod: null, backupId: null, shift: '8:00–17:00' },
]

export const MANAGER_ID = 'S14'
export const CHARGE_NURSE_ID = 'S06'

export const SEED_RULES: string[] = [
  'Routine refill requests for non-controlled maintenance medications go to Pharmacy, not the physician.',
  "Refill requests for controlled substances (e.g. tramadol, alprazolam, methylphenidate) always go to the patient's own PCP.",
  'Scheduling, rescheduling and cancellations go to the Front Desk.',
  'Bills, statements, payment plans, coverage and prior authorization questions go to Billing. Never include clinical details for Billing.',
  "Referral status questions and FMLA/disability forms go to the patient's pod MA.",
  'Records requests and immunization record copies go to the Front Desk.',
  'Any new or worsening symptom goes to the Triage RN, even if the patient sounds calm.',
  "Lab questions about results already released to the patient go to the patient's pod MA; questions asking for a treatment change or diagnosis go to the PCP.",
  'If a message is vague or you cannot tell what the patient needs, send it to the Triage RN review queue.',
]

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  confidence_threshold: 0.7,
  sla_emergency_minutes: 15,
  sla_urgent_minutes: 60,
  simulate_llm_outage: false,
  email_new_tasks: false,
}
