export type ChatRole = 'user' | 'assistant' | 'system'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface ModelApiConfig {
  apiKey: string
  baseUrl: string
  model: string
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string
    }
  }>
  error?: {
    message?: string
  }
}

export class ModelApiClient {
  async complete(
    config: ModelApiConfig,
    messages: ChatMessage[],
  ): Promise<string> {
    const response = await fetch(`${trimTrailingSlash(config.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.2,
      }),
    })

    const data = (await response.json().catch(() => ({}))) as ChatCompletionResponse

    if (!response.ok) {
      throw new Error(data.error?.message ?? `Model API request failed: ${response.status}`)
    }

    const content = data.choices?.[0]?.message?.content?.trim()

    if (!content) {
      throw new Error('Model API returned an empty response.')
    }

    return content
  }
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '')
}
