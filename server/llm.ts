import Anthropic from '@anthropic-ai/sdk'
import { eq } from 'drizzle-orm'
import { db, agentRuns, agentSteps } from '../db'

export const AGENT_MODEL = 'claude-sonnet-5-5'
export const FAST_MODEL = 'claude-haiku-5-5'

let client: Anthropic | null = null
export function anthropic() {
  // AI Gateway injects credentials; a user-supplied ANTHROPIC_API_KEY also works.
  client ??= new Anthropic({ maxRetries: 4 })
  return client
}

export class LlmUnavailableError extends Error {}

export interface AgentTool<Ctx> {
  name: string
  description: string
  input_schema: Anthropic.Tool['input_schema']
  // Return a value for the model. Throw ToolInputError for a recoverable
  // error the model should fix (sent back as is_error).
  run: (input: any, ctx: Ctx) => Promise<unknown>
}

export class ToolInputError extends Error {}

export interface RunRecord {
  runId: number
  stepNo: number
  inputTokens: number
  outputTokens: number
}

export async function startAgentRun(opts: {
  agent: 'triage' | 'prep'
  model: string
  messageId?: number | null
  taskId?: number | null
  evalRunId?: number | null
}): Promise<RunRecord> {
  const [row] = await db
    .insert(agentRuns)
    .values({
      agent: opts.agent,
      model: opts.model,
      messageId: opts.messageId ?? null,
      taskId: opts.taskId ?? null,
      evalRunId: opts.evalRunId ?? null,
    })
    .returning({ id: agentRuns.id })
  return { runId: row.id, stepNo: 0, inputTokens: 0, outputTokens: 0 }
}

export async function logStep(run: RunRecord, kind: string, title: string, detail?: unknown) {
  run.stepNo += 1
  await db.insert(agentSteps).values({
    runId: run.runId,
    stepNo: run.stepNo,
    kind,
    title: title.slice(0, 500),
    detail: detail === undefined ? null : truncateDeep(detail),
  })
  await db
    .update(agentRuns)
    .set({ stepCount: run.stepNo })
    .where(eq(agentRuns.id, run.runId))
}

export async function finishAgentRun(
  run: RunRecord,
  status: 'done' | 'failed' | 'fallback',
  output: unknown,
  error?: string,
) {
  await db
    .update(agentRuns)
    .set({
      status,
      output: output ?? null,
      error: error ?? null,
      stepCount: run.stepNo,
      inputTokens: run.inputTokens,
      outputTokens: run.outputTokens,
      finishedAt: new Date(),
    })
    .where(eq(agentRuns.id, run.runId))
}

function truncateDeep(v: unknown): unknown {
  const s = JSON.stringify(v)
  if (s.length <= 6000) return v
  return { truncated: true, preview: s.slice(0, 6000) }
}

function isOutage(err: unknown) {
  if (err instanceof Anthropic.APIError) {
    return err.status === undefined || err.status >= 500 || err.status === 429 || err.status === 401
  }
  return err instanceof Anthropic.APIConnectionError
}

// A tool-use loop: the model decides which tools to call and in which order.
// The loop ends when the model calls `finalTool` with valid input, or fails
// after `maxSteps` model turns.
export async function runToolLoop<Ctx, Final>(opts: {
  run: RunRecord
  model: string
  system: string
  task: string
  tools: AgentTool<Ctx>[]
  finalTool: string
  ctx: Ctx
  maxSteps: number
}): Promise<Final> {
  const { run, ctx } = opts
  const toolMap = new Map(opts.tools.map((t) => [t.name, t]))
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: opts.task }]
  let nudged = false

  for (let turn = 1; turn <= opts.maxSteps; turn++) {
    let response: Anthropic.Message
    try {
      response = await anthropic().messages.create({
        model: opts.model,
        max_tokens: 2048,
        system: opts.system,
        tools: opts.tools.map(({ name, description, input_schema }) => ({
          name,
          description,
          input_schema,
        })),
        messages,
      })
    } catch (err) {
      if (isOutage(err)) throw new LlmUnavailableError(String((err as Error).message))
      throw err
    }
    run.inputTokens += response.usage.input_tokens
    run.outputTokens += response.usage.output_tokens
    messages.push({ role: 'assistant', content: response.content })

    const thoughts = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text.trim())
      .filter(Boolean)
      .join(' ')
    if (thoughts) await logStep(run, 'llm', thoughts, { turn, model: opts.model })

    const toolUses = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    )
    if (toolUses.length === 0) {
      if (nudged) break
      nudged = true
      messages.push({
        role: 'user',
        content: `You must finish by calling the ${opts.finalTool} tool.`,
      })
      continue
    }

    const results: Anthropic.ToolResultBlockParam[] = []
    let final: Final | undefined
    for (const use of toolUses) {
      const tool = toolMap.get(use.name)
      await logStep(run, 'tool_call', `Called ${use.name}`, use.input)
      if (!tool) {
        results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: 'Unknown tool' })
        continue
      }
      try {
        const out = await tool.run(use.input, ctx)
        if (use.name === opts.finalTool) {
          final = out as Final
          await logStep(run, 'decision', 'Submitted final output', out)
        } else {
          await logStep(run, 'tool_result', `${use.name} returned`, out)
        }
        results.push({ type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(out) })
      } catch (err) {
        if (!(err instanceof ToolInputError)) throw err
        await logStep(run, 'guardrail', `${use.name} rejected input: ${err.message}`)
        results.push({ type: 'tool_result', tool_use_id: use.id, is_error: true, content: err.message })
      }
    }
    if (final !== undefined) return final
    messages.push({ role: 'user', content: results })
  }
  throw new Error(`Agent stopped: reached the ${opts.maxSteps}-step limit without a final decision`)
}

// Single structured call used for cheap classification / checking passes.
export async function structuredCall<T>(opts: {
  model: string
  system: string
  prompt: string
  toolName: string
  schema: Anthropic.Tool['input_schema']
  run?: RunRecord
}): Promise<T> {
  let res: Anthropic.Message
  try {
    res = await anthropic().messages.create({
      model: opts.model,
      max_tokens: 1024,
      system: opts.system,
      tools: [{ name: opts.toolName, description: 'Record the result.', input_schema: opts.schema }],
      tool_choice: { type: 'tool', name: opts.toolName },
      messages: [{ role: 'user', content: opts.prompt }],
    })
  } catch (err) {
    if (isOutage(err)) throw new LlmUnavailableError(String((err as Error).message))
    throw err
  }
  if (opts.run) {
    opts.run.inputTokens += res.usage.input_tokens
    opts.run.outputTokens += res.usage.output_tokens
  }
  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
  if (!block) throw new Error('No structured output returned')
  return block.input as T
}
