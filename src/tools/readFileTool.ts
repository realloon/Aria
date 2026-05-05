import type { BuiltinTool } from '../types/tools.js'
import { readFile } from 'node:fs/promises'
import { getString, resolvePath } from './validation.js'

export const readFileTool: BuiltinTool = {
  definition: {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a text file.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'File path.',
          },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  async execute(args, context) {
    const filePath = resolvePath(context.cwd, getString(args, 'path'))
    return await readFile(filePath, 'utf-8')
  },
}
