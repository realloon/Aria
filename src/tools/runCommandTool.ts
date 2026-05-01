import type { BuiltinTool } from './types.js'
import { exec } from 'node:child_process'
import { getOptionalNumber, getString, resolvePath } from './validation.js'

export const runCommandTool: BuiltinTool = {
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
            description: 'Optional timeout in milliseconds. Defaults to 30000.',
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
