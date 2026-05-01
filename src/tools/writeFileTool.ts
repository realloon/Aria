import type { BuiltinTool } from './types.js'
import { dirname } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { getString, resolvePath } from './validation.js'

export const writeFileTool: BuiltinTool = {
  definition: {
    type: 'function',
    function: {
      name: 'write_file',
      description:
        'Write UTF-8 text to a file. Supports overwrite and append modes.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'File path. Relative paths resolve from the workspace root.',
          },
          content: {
            type: 'string',
            description: 'Text content to write.',
          },
          mode: {
            type: 'string',
            enum: ['overwrite', 'append'],
            description:
              'Use overwrite to replace the file, or append to add to it.',
          },
        },
        required: ['path', 'content', 'mode'],
        additionalProperties: false,
      },
    },
  },
  async execute(args, context) {
    const filePath = resolvePath(context.cwd, getString(args, 'path'))
    const content = getString(args, 'content')
    const mode = getString(args, 'mode')

    if (mode !== 'overwrite' && mode !== 'append') {
      throw new Error('write_file mode must be "overwrite" or "append".')
    }

    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, content, {
      encoding: 'utf-8',
      flag: mode === 'append' ? 'a' : 'w',
    })

    return {
      path: filePath,
      mode,
      bytes: Buffer.byteLength(content, 'utf-8'),
    }
  },
}
