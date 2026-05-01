import type { BuiltinTool } from './types.js'
import { readFile } from 'node:fs/promises'
import { getString, resolvePath } from './validation.js'

export const readFileTool: BuiltinTool = {
  definition: {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a UTF-8 text file from the workspace.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'File path. Relative paths resolve from the workspace root.',
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
