// Deterministic red-flag screen. Runs BEFORE any AI. It intentionally errs
// toward over-escalation: a false alarm costs a nurse phone call, a miss can
// cost a life. Changes to this list should go through clinical governance.

export interface RedFlagRule {
  category: string
  patterns: RegExp[]
}

export const RED_FLAG_RULES: RedFlagRule[] = [
  {
    category: 'Chest pain / pressure',
    patterns: [
      /chest\s+(pain|pressure|tightness|tight|hurts|hurting|heavy|heaviness|discomfort)/i,
      /(pain|pressure|tightness|squeezing|heaviness)\s+(in|on)\s+(my\s+)?chest/i,
      /heart\s+attack/i,
    ],
  },
  {
    category: 'Trouble breathing / airway',
    patterns: [
      /(can'?t|cannot|can not|hard to|trouble|difficulty|struggling to|unable to)\s+(breathe|breathing|catch\s+my\s+breath|get\s+air)/i,
      /short(ness)?\s+of\s+breath/i,
      /throat\s+(is\s+|feels\s+)?(closing|tight|swelling|swollen)/i,
      /(lips|tongue|face)\s+(is\s+|are\s+)?(swelling|swollen)/i,
      /anaphyla/i,
      /turning\s+blue/i,
      /breathing\s+(really\s+|very\s+|so\s+)?(fast|hard|rapid)/i,
      /pulling\s+in\s+(between|under)\s+(his|her|their|my|the)\s+ribs|retractions/i,
      /inhaler.{0,60}(not|isn'?t)\s+(helping|working)/i,
    ],
  },
  {
    category: 'Stroke signs',
    patterns: [
      /face\s+(is\s+)?droop/i,
      /drooping\s+(face|mouth|on one side)/i,
      /slurr(ed|ing)/i,
      /face\b.{0,25}droop/i,
      /(corner\s+of\s+(his|her|their|my)\s+mouth|mouth|smile)\b.{0,20}\b(lower|droop|drooping|lopsided|uneven)/i,
      /garbled|jumbled\s+(words|speech)/i,
      /(right|left)\s+(arm|leg|hand)\s+(is\s+|feels\s+|went\s+)?(weak|numb|limp)/i,
      /(can'?t|cannot)\s+(grip|lift|raise|move|hold)\b.{0,40}\b(right|left)\s+(hand|arm|leg)/i,
      /(one|left|right)\s+side\s+(of\s+my\s+(body|face)\s+)?(is\s+|feels\s+|went\s+|going\s+)?(weak|numb|limp)/i,
      /(sudden(ly)?)\s+(can'?t|cannot)\s+(speak|talk|see|move)/i,
      /worst\s+headache\s+of\s+my\s+life/i,
      /\bstroke\b/i,
    ],
  },
  {
    category: 'Suicidal thoughts / self-harm',
    patterns: [
      /suicid/i,
      /kill\s+(myself|me)/i,
      /end(ing)?\s+(my\s+life|it\s+all|things)/i,
      /(don'?t|do not)\s+want\s+to\s+(live|be alive|be here|wake up)/i,
      /(hurt|harm|cut)(ing)?\s+myself/i,
      /self[-\s]?harm/i,
      /better\s+off\s+(dead|without me)/i,
    ],
  },
  {
    category: 'Severe bleeding',
    patterns: [
      /bleeding\s+(that\s+)?(won'?t|will not|doesn'?t|does not|wont)\s+stop/i,
      /(heavy|severe|a lot of|lots of|uncontrolled|profuse)\s+bleeding/i,
      /(won'?t|wont|will not|doesn'?t|does not|not)\s+stop(ped)?\s+bleeding/i,
      /soaked\s+through/i,
      /(soak|soaking|soaked)(ed)?\s+(through\s+)?(a|the|my)?\s*(pad|towel|bandage)/i,
      /(coughing|throwing|vomiting)\s+up\s+blood|vomiting\s+blood/i,
      /blood\s+everywhere/i,
    ],
  },
  {
    category: 'Loss of consciousness / seizure / overdose',
    patterns: [
      /passed\s+out|fainted|unconscious|unresponsive/i,
      /seizure/i,
      /overdos|took\s+too\s+many/i,
    ],
  },
]

export function screenForRedFlags(text: string): { category: string; match: string }[] {
  const hits: { category: string; match: string }[] = []
  for (const rule of RED_FLAG_RULES) {
    for (const p of rule.patterns) {
      const m = text.match(p)
      if (m) {
        hits.push({ category: rule.category, match: m[0] })
        break
      }
    }
  }
  return hits
}

// Pre-approved, fixed patient message. Never AI-generated.
export const EMERGENCY_TEMPLATE =
  'Your message mentions symptoms that may need emergency care. Please call 911 or go to the nearest emergency room now — do not wait for a portal reply. If you are thinking about suicide or hurting yourself, call or text 988 (Suicide & Crisis Lifeline). A nurse from your care team has been alerted and may also call you. Portal messages are not monitored for emergencies.'
