import type { Config } from '@netlify/functions'
import { isInternal } from '../../server/internal'
import { runEvaluation } from '../../server/eval'

// Background function: runs the 30-case labeled test set through the live
// safety screen + Triage & Routing Agent.
export default async (req: Request) => {
  if (!(await isInternal(req))) return
  const { evalRunId } = (await req.json()) as { evalRunId: number }
  await runEvaluation(evalRunId)
}

export const config: Config = {
  background: true,
}
