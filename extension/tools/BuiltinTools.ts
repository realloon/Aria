import { exec } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { ChatCompletionFunctionTool } from 'openai/resources/chat/completions'

type JsonObject = Record<string, unknown>

export interface BuiltinToolContext {
  cwd: string
}

export interface BuiltinTool {
  definition: ChatCompletionFunctionTool
  execute(args: JsonObject, context: BuiltinToolContext): Promise<unknown>
}

export const builtinTools: BuiltinTool[] = [
  {
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
      return await fs.readFile(filePath, 'utf-8')
    },
  },
  {
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

      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, content, {
        encoding: 'utf-8',
        flag: mode === 'append' ? 'a' : 'w',
      })

      return {
        path: filePath,
        mode,
        bytes: Buffer.byteLength(content, 'utf-8'),
      }
    },
  },
  {
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
        throw new Error(
          'patch_file could not find old_text in the target file.',
        )
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
  },
  {
    definition: {
      type: 'function',
      function: {
        name: 'run_command',
        description: 'Run a shell command in the workspace.',
        parameters: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'Shell command to execute.',
            },
            cwd: {
              type: 'string',
              description:
                'Optional working directory. Relative paths resolve from the workspace root.',
            },
            timeout_ms: {
              type: 'number',
              description:
                'Optional timeout in milliseconds. Defaults to 30000.',
            },
          },
          required: ['command'],
          additionalProperties: false,
        },
      },
    },
    async execute(args, context) {
      const command = getString(args, 'command')
      const cwd = args.cwd
        ? resolvePath(context.cwd, getString(args, 'cwd'))
        : context.cwd
      const timeout = getOptionalNumber(args, 'timeout_ms') ?? 30_000

      return await runCommand(command, cwd, timeout)
    },
  },
]

const toolsByName = new Map(
  builtinTools.map(tool => [tool.definition.function.name, tool]),
)

export const builtinToolDefinitions = builtinTools.map(tool => tool.definition)

export async function executeBuiltinTool(
  name: string,
  argsJson: string,
  context: BuiltinToolContext,
): Promise<string> {
  const tool = toolsByName.get(name)

  if (!tool) {
    return JSON.stringify({ ok: false, error: `Unknown tool: ${name}` })
  }

  try {
    const args = parseArgs(argsJson)
    const result = await tool.execute(args, context)
    return JSON.stringify({ ok: true, result })
  } catch (error) {
    return JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : 'Tool execution failed.',
    })
  }
}

function parseArgs(argsJson: string): JsonObject {
  const parsed = JSON.parse(argsJson || '{}') as unknown

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Tool arguments must be a JSON object.')
  }

  return parsed as JsonObject
}

function getString(args: JsonObject, key: string): string {
  const value = args[key]

  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string.`)
  }

  return value
}

function getOptionalBoolean(
  args: JsonObject,
  key: string,
): boolean | undefined {
  const value = args[key]

  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'boolean') {
    throw new Error(`${key} must be a boolean.`)
  }

  return value
}

function getOptionalNumber(args: JsonObject, key: string): number | undefined {
  const value = args[key]

  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${key} must be a positive number.`)
  }

  return value
}

function resolvePath(cwd: string, targetPath: string): string {
  return path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(cwd, targetPath)
}

function runCommand(
  command: string,
  cwd: string,
  timeout: number,
): Promise<unknown> {
  return new Promise(resolve => {
    exec(
      command,
      {
        cwd,
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        resolve({
          exit_code: getExitCode(error),
          stdout,
          stderr,
        })
      },
    )
  })
}

function getExitCode(error: Error | null): number {
  if (!error) {
    return 0
  }

  const maybeCode = (error as { code?: unknown }).code
  return typeof maybeCode === 'number' ? maybeCode : 1
}
