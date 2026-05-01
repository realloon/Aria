import fs from 'node:fs/promises'
import type { BuiltinTool } from './types.js'
import { getOptionalBoolean, getString, resolvePath } from './validation.js'

export const patchFileTool: BuiltinTool = {
  definition: {
    type: 'function',
    function: {
      name: 'patch_file',
      description: 'Patch part of a UTF-8 text file by replacing exact text.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description:
              'File path. Relative paths resolve from the workspace root.',
          },
          old_text: {
            type: 'string',
            description: 'Exact text to replace.',
          },
          new_text: {
            type: 'string',
            description: 'Replacement text.',
          },
          replace_all: {
            type: 'boolean',
            description: 'Replace every match. Defaults to false.',
          },
        },
        required: ['path', 'old_text', 'new_text'],
        additionalProperties: false,
      },
    },
  },
  async execute(args, context) {
    const filePath = resolvePath(context.cwd, getString(args, 'path'))
    const oldText = getString(args, 'old_text')
    const newText = getString(args, 'new_text')
    const replaceAll = getOptionalBoolean(args, 'replace_all') ?? false

    if (!oldText) {
      throw new Error('patch_file old_text cannot be empty.')
    }

    const content = await fs.readFile(filePath, 'utf-8')
    const matches = content.split(oldText).length - 1

    if (matches === 0) {
      throw new Error('patch_file could not find old_text in the target file.')
    }

    if (matches > 1 && !replaceAll) {
      throw new Error(
        'patch_file found multiple matches. Set replace_all to true or provide more specific old_text.',
      )
    }

    const nextContent = replaceAll
      ? content.split(oldText).join(newText)
      : content.replace(oldText, newText)

    await fs.writeFile(filePath, nextContent, 'utf-8')

    return {
      path: filePath,
      replacements: replaceAll ? matches : 1,
    }
  },
}
