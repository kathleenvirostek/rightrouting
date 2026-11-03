import type { Config } from '@netlify/functions'
import { ensureSeeded } from '../../server/seed'
import { runSlaWatchdog } from '../../server/watchdog'

// Automation 2 trigger: Netlify Scheduled Function, every 15 minutes.
export default async () => {
  await ensureSeeded()
  await runSlaWatchdog('schedule')
}

export const config: Config = {
  schedule: '*/15 * * * *',
}
