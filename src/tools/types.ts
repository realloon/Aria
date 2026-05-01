import type { ChatCompletionFunctionTool } from 'openai/resources/chat/completions'

export type JsonObject = Record<string, unknown>

export interface BuiltinToolContext {
  cwd: string
  askUser?(question: string, options: string[]): Promise<string>
}

export interface BuiltinTool {
  definition: ChatCompletionFunctionTool
  execute(args: JsonObject, context: BuiltinToolContext): Promise<unknown>
}
