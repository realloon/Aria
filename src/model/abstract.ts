import OpenAI from 'openai'
import {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from 'openai/resources/chat/completions'

export interface ModelChatInput {
  model: string
  input?: string
  tools?: ChatCompletionTool[]
  executeTool?(toolCall: ChatCompletionMessageToolCall): Promise<string>
  maxToolRounds?: number
  signal?: AbortSignal
}

export interface ModelCompletionInput {
  model: string
  prefix: string
  suffix?: string
  maxTokens: number
  signal?: AbortSignal
}

export type ModelChatEvent =
  | { type: 'content'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'toolCalls'; toolCalls: ChatCompletionMessageToolCall[] }

export abstract class Model<ChatInput extends ModelChatInput> {
  protected readonly client: OpenAI
  readonly messages: ChatCompletionMessageParam[] = []
  protected systemPrompt = ''

  constructor(baseURL: string, apiKey: string, systemPrompt: string = '') {
    this.client = new OpenAI({ baseURL, apiKey })
    this.systemPrompt = systemPrompt
  }

  updateSystemPrompt(prompt: string) {
    this.systemPrompt = prompt
  }

  abstract chat(input: ChatInput): AsyncGenerator<ModelChatEvent>

  async complete(input: ModelCompletionInput): Promise<string> {
    const response = await this.client.completions.create(
      {
        model: input.model,
        prompt: input.prefix,
        suffix: input.suffix,
        max_tokens: input.maxTokens,
      },
      {
        signal: input.signal,
        timeout: 10_000,
        maxRetries: 0,
      },
    )

    return response.choices[0]?.text ?? ''
  }
}
