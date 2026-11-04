import type { Config } from '@netlify/functions'
import { isInternal } from '../../server/internal'
import { processMessages, prepTasks } from '../../server/pipeline'

// Background function: runs the Triage & Routing Agent (Automation 1, steps
// 2–4) and then the Care Team Prep Agent for each created task.
export default async (req: Request) => {
  if (!(await isInternal(req))) return
  const { messageIds, prepTaskIds } = (await req.json()) as { messageIds?: number[]; prepTaskIds?: number[] }
  if (messageIds?.length) await processMessages(messageIds)
  if (prepTaskIds?.length) await prepTasks(prepTaskIds)
}

export const config: Config = {
  background: true,
}
