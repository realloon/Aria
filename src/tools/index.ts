import { patchFileTool } from './patchFileTool.js'
import { readFileTool } from './readFileTool.js'
import { runCommandTool } from './runCommandTool.js'
import type { BuiltinTool, BuiltinToolContext } from './types.js'
import { parseArgs } from './validation.js'
import { writeFileTool } from './writeFileTool.js'

export const builtinTools: BuiltinTool[] = [
  readFileTool,
  writeFileTool,
  patchFileTool,
  runCommandTool,
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
