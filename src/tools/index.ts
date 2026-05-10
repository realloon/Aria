import { askUserTool } from './askUserTool.js'
import type { BuiltinTool, BuiltinToolContext } from '../types/tools.js'
import { patchFileTool } from './patchFileTool.js'
import { readFileTool } from './readFileTool.js'
import { runCommandTool } from './runCommandTool.js'
import { parseArgs } from './validation.js'
import { writeFileTool } from './writeFileTool.js'

const builtinToolSource = 'builtin'

export const builtinTools = [
  readFileTool,
  writeFileTool,
  patchFileTool,
  runCommandTool,
  askUserTool,
] satisfies BuiltinTool[]

const toolsByName = new Map(
  builtinTools.map(tool => [
    toNamespacedToolName(tool.definition.function.name),
    tool,
  ]),
)

export const builtinToolDefinitions = builtinTools.map(tool => ({
  ...tool.definition,
  function: {
    ...tool.definition.function,
    name: toNamespacedToolName(tool.definition.function.name),
  },
}))

export async function executeBuiltinTool(
  name: string,
  argsJson: string,
  context: BuiltinToolContext,
) {
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

function toNamespacedToolName(toolName: string) {
  return `${builtinToolSource}__${toolName}`
}
