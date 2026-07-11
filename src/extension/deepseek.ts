import type { ChangeContext } from './gitRepository.js'

const apiURL = 'https://api.deepseek.com/chat/completions'
const model = 'deepseek-v4-flash'

interface ResponseBody {
  choices?: Array<{
    message?: {
      content?: string | null
    }
  }>
}

const systemPrompt = `You generate Git commit messages.

Rules:
- Output exactly one commit message and nothing else.
- Use the format "type: message".
- Keep it concise.
- Use the most specific type from feat, fix, refactor, docs, test, style, build, ci, perf, chore.
- Prefer English unless the code changes are explicitly Chinese-language user-facing text.
- Do not mention files unless the filename is the product-visible concept.`

export async function requestCommitMessage(
  apiKey: string,
  changeContext: ChangeContext,
) {
  const response = await fetch(apiURL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Generate a commit message for these ${changeContext.mode} changes:\n\n${changeContext.diff}`,
        },
      ],
    }),
  })

  if (!response.ok) {
    throw new Error(
      `DeepSeek request failed (${response.status}): ${await response.text()}`,
    )
  }

  const body: ResponseBody = await response.json()
  const message = normalizeCommitMessage(
    body.choices?.[0]?.message?.content ?? '',
  )

  if (!message) {
    throw new Error('Model returned an empty commit message.')
  }

  return message
}

function normalizeCommitMessage(value: string) {
  return (
    value
      .trim()
      .replace(/^```(?:\w+)?\s*/, '')
      .replace(/\s*```$/, '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)[0]
      ?.replace(/^["']|["']$/g, '')
      .trim()
      .slice(0, 200) ?? ''
  )
}
