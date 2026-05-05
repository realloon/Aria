import type { BuiltinTool } from '../types/tools.js'
import { getOptionalStringArray, getString } from './validation.js'

export const askUserTool: BuiltinTool = {
  definition: {
    type: 'function',
    function: {
      name: 'ask_user',
      description: 'Ask the user a question.',
      parameters: {
        type: 'object',
        properties: {
          question: {
            type: 'string',
            description: 'Question.',
          },
          options: {
            type: 'array',
            items: {
              type: 'string',
            },
            description: 'Suggested answers.',
          },
        },
        required: ['question'],
        additionalProperties: false,
      },
    },
  },
  async execute(args, context) {
    if (!context.askUser) {
      throw new Error('ask_user is unavailable.')
    }

    return await context.askUser(
      getString(args, 'question'),
      getOptionalStringArray(args, 'options') ?? [],
    )
  },
}
