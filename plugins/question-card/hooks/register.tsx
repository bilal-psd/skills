import type { EngineInterface, Register } from 'claude-code'

// The built-in AskUserQuestion takes at most 4 questions. ask_many takes the same
// shape with no cap and asks them one by one in the engine's own dialog.
const TOOL = 'mcp__question-card__ask_many'

type Option = { label: string; description?: string }
type Question = { question: string; header?: string; options?: Option[]; multiSelect?: boolean }

const DESCRIPTION = `Ask the user more than 4 questions in the built-in question dialog, one after another. Use this instead of AskUserQuestion only when you have 5 or more questions; for 1 to 4, use AskUserQuestion. Same input shape as AskUserQuestion: each question ends in "?", has a short header (12 chars max) and 2 to 4 options with concise labels; the user can always type their own answer under "Other". Put a recommended option first and add "(Recommended)" to its label. Returns every answer; if the user dismisses the dialog, you get the answers given so far.`

const SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The full question, ending in a question mark' },
          header: { type: 'string', description: 'Short chip label, 12 characters at most' },
          options: {
            type: 'array',
            minItems: 2,
            maxItems: 4,
            items: {
              type: 'object',
              properties: {
                label: { type: 'string' },
                description: { type: 'string' },
              },
              required: ['label'],
            },
          },
          multiSelect: { type: 'boolean' },
        },
        required: ['question', 'options'],
      },
    },
  },
  required: ['questions'],
}

async function askAll($: EngineInterface, questions: Question[]) {
  const lines: string[] = []
  for (const [i, q] of questions.entries()) {
    const labels = (q.options ?? []).map(o => o.label).slice(0, 4)
    const header = q.header ? q.header.slice(0, 12) : `${i + 1} of ${questions.length}`
    try {
      const answer = await $.ui.ask(q.question, {
        options: labels,
        header,
        ...(q.multiSelect ? { multiSelect: true as const } : {}),
      })
      lines.push(`${i + 1}. ${q.question} → ${answer}`)
    } catch {
      lines.push(`The user dismissed the dialog at question ${i + 1}; questions ${i + 1}-${questions.length} are unanswered.`)
      break
    }
  }
  return lines.join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({ name: 'ask_many', description: DESCRIPTION, inputSchema: SCHEMA })
    return next(e)
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    const questions = (e as unknown as { questions?: Question[] }).questions ?? []
    if (!questions.length) return { deny: 'ask_many needs at least one question.' }
    return { result: await askAll($, questions) }
  })
}
