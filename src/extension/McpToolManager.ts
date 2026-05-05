import type {
  CallToolResult,
  Client,
  StdioServerParameters,
  StreamableHTTPClientTransportOptions,
  Transport,
} from '@modelcontextprotocol/client'
import type { ChatCompletionFunctionTool } from 'openai/resources/chat/completions'
import * as vscode from 'vscode'
import { parseArgs } from '../tools/validation.js'

type McpClientModule = typeof import('@modelcontextprotocol/client')

interface McpServerConfigBase {
  disabled: boolean
}

interface McpStdioServerConfig extends McpServerConfigBase {
  command: StdioServerParameters['command']
  args?: StdioServerParameters['args']
  cwd?: StdioServerParameters['cwd']
  env?: StdioServerParameters['env']
}

interface McpHttpServerConfig extends McpServerConfigBase {
  url: string
  headers?: NonNullable<
    StreamableHTTPClientTransportOptions['requestInit']
  >['headers']
}

type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig

interface McpConnection {
  client: Client
  transport: Transport
}

interface McpToolRef {
  serverName: string
  toolName: string
}

export class McpToolManager {
  private readonly connections = new Map<string, McpConnection>()
  private readonly toolsByOpenAiName = new Map<string, McpToolRef>()
  private configSignature = ''

  async getToolDefinitions(
    workspaceFolder: vscode.WorkspaceFolder,
  ): Promise<ChatCompletionFunctionTool[]> {
    const configs = await getMcpServerConfigs(workspaceFolder)
    const signature = JSON.stringify(configs)

    if (signature !== this.configSignature) {
      await this.dispose()
      this.configSignature = signature
    }

    this.toolsByOpenAiName.clear()

    const definitions: ChatCompletionFunctionTool[] = []

    for (const [serverName, config] of configs) {
      const connection = await this.getConnection(serverName, config)
      let cursor: string | undefined

      do {
        const result = await connection.client.listTools(
          cursor ? { cursor } : undefined,
        )

        for (const tool of result.tools) {
          const openAiName = toOpenAiToolName(serverName, tool.name)

          if (this.toolsByOpenAiName.has(openAiName)) {
            throw new Error(`Duplicate MCP tool name: ${openAiName}`)
          }

          this.toolsByOpenAiName.set(openAiName, {
            serverName,
            toolName: tool.name,
          })
          definitions.push({
            type: 'function',
            function: {
              name: openAiName,
              description: tool.description,
              parameters:
                tool.inputSchema as ChatCompletionFunctionTool['function']['parameters'],
            },
          })
        }

        cursor = result.nextCursor
      } while (cursor)
    }

    return definitions
  }

  hasTool(name: string): boolean {
    return this.toolsByOpenAiName.has(name)
  }

  async executeTool(name: string, argsJson: string): Promise<string> {
    const toolRef = this.toolsByOpenAiName.get(name)

    if (!toolRef) {
      return JSON.stringify({ ok: false, error: `Unknown MCP tool: ${name}` })
    }

    const connection = this.connections.get(toolRef.serverName)

    if (!connection) {
      return JSON.stringify({
        ok: false,
        error: `MCP server is not connected: ${toolRef.serverName}`,
      })
    }

    try {
      const args = parseArgs(argsJson)
      const result = await connection.client.callTool({
        name: toolRef.toolName,
        arguments: args,
      })

      return serializeToolResult(result)
    } catch (error) {
      return JSON.stringify({
        ok: false,
        error:
          error instanceof Error ? error.message : 'MCP tool execution failed.',
      })
    }
  }

  async dispose(): Promise<void> {
    const connections = [...this.connections.values()]
    this.connections.clear()
    this.toolsByOpenAiName.clear()

    await Promise.all(
      connections.map(async connection => {
        await connection.transport.close()
      }),
    )
  }

  private async getConnection(
    serverName: string,
    config: McpServerConfig,
  ): Promise<McpConnection> {
    const cached = this.connections.get(serverName)

    if (cached) {
      return cached
    }

    const mcpClient = await loadMcpClient()
    const client = new mcpClient.Client({
      name: 'aria',
      version: '0.4.0',
    })
    const transport = createTransport(config, mcpClient)
    await client.connect(transport)

    const connection = { client, transport }
    this.connections.set(serverName, connection)

    return connection
  }
}

function getMcpServerConfigs(
  workspaceFolder: vscode.WorkspaceFolder,
): Promise<Array<[string, McpServerConfig]>> {
  return readMcpServerConfigs(workspaceFolder)
}

async function readMcpServerConfigs(
  workspaceFolder: vscode.WorkspaceFolder,
): Promise<Array<[string, McpServerConfig]>> {
  const configUri = vscode.Uri.joinPath(
    workspaceFolder.uri,
    '.agents',
    'mcp.json',
  )

  let content: Uint8Array

  try {
    content = await vscode.workspace.fs.readFile(configUri)
  } catch (error) {
    if (error instanceof vscode.FileSystemError) {
      return []
    }

    throw error
  }

  const parsed = JSON.parse(new TextDecoder('utf-8').decode(content)) as unknown

  if (!isRecord(parsed)) {
    throw new Error('.agents/mcp.json must be an object.')
  }

  const servers = parsed.mcpServers

  if (!isRecord(servers)) {
    throw new Error('.agents/mcp.json must contain a mcpServers object.')
  }

  return Object.entries(servers)
    .map(([name, value]): [string, McpServerConfig] => [
      name,
      parseMcpServerConfig(name, value, workspaceFolder),
    ])
    .filter(([, serverConfig]) => !serverConfig.disabled)
}

function parseMcpServerConfig(
  name: string,
  value: unknown,
  workspaceFolder: vscode.WorkspaceFolder,
): McpServerConfig {
  if (!isValidServerName(name)) {
    throw new Error(
      `MCP server name must use only letters, numbers, underscores, or hyphens: ${name}`,
    )
  }

  if (!isRecord(value)) {
    throw new Error(`MCP server config must be an object: ${name}`)
  }

  const disabled = value.disabled === true

  if (typeof value.command === 'string') {
    return {
      disabled,
      command: expandVariables(
        getRequiredString(value, 'command', name),
        workspaceFolder,
      ),
      args: getOptionalStringArray(value, 'args', name)?.map(arg =>
        expandVariables(arg, workspaceFolder),
      ),
      cwd:
        expandOptionalString(value.cwd, 'cwd', name, workspaceFolder) ??
        workspaceFolder.uri.fsPath,
      env: expandOptionalStringRecord(value.env, 'env', name, workspaceFolder),
    }
  }

  if (typeof value.url === 'string') {
    return {
      disabled,
      url: expandVariables(
        getRequiredString(value, 'url', name),
        workspaceFolder,
      ),
      headers: expandOptionalStringRecord(
        value.headers,
        'headers',
        name,
        workspaceFolder,
      ),
    }
  }

  throw new Error(`MCP server ${name} must define command or url.`)
}

function createTransport(
  config: McpServerConfig,
  mcpClient: McpClientModule,
): Transport {
  if ('command' in config) {
    const transport = new mcpClient.StdioClientTransport({
      command: config.command,
      args: config.args,
      cwd: config.cwd,
      env: config.env
        ? {
            ...mcpClient.getDefaultEnvironment(),
            ...config.env,
          }
        : undefined,
      stderr: 'pipe',
    })

    transport.stderr?.on('data', () => {})

    return transport
  }

  return new mcpClient.StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: config.headers
      ? {
          headers: config.headers,
        }
      : undefined,
  })
}

async function loadMcpClient(): Promise<McpClientModule> {
  return await import('@modelcontextprotocol/client')
}

function toOpenAiToolName(serverName: string, toolName: string): string {
  const name = `${serverName}__${toolName}`

  if (!/^[A-Za-z0-9_-]{1,64}$/.test(name)) {
    throw new Error(
      `MCP tool name must use source__tool_name, match [A-Za-z0-9_-], and be at most 64 chars: ${name}`,
    )
  }

  return name
}

function serializeToolResult(result: CallToolResult): string {
  return JSON.stringify({
    ok: result.isError !== true,
    result,
  })
}

function getRequiredString(
  value: Record<string, unknown>,
  key: string,
  serverName: string,
): string {
  const item = value[key]

  if (typeof item !== 'string' || item.trim() === '') {
    throw new Error(`MCP server ${serverName}.${key} must be a string.`)
  }

  return item
}

function getOptionalStringArray(
  value: Record<string, unknown>,
  key: string,
  serverName: string,
): string[] | undefined {
  const item = value[key]

  if (item === undefined) {
    return undefined
  }

  if (!Array.isArray(item) || item.some(entry => typeof entry !== 'string')) {
    throw new Error(`MCP server ${serverName}.${key} must be a string array.`)
  }

  return item
}

function expandOptionalString(
  value: unknown,
  key: string,
  serverName: string,
  workspaceFolder: vscode.WorkspaceFolder,
): string | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new Error(`MCP server ${serverName}.${key} must be a string.`)
  }

  return expandVariables(value, workspaceFolder)
}

function expandOptionalStringRecord(
  value: unknown,
  key: string,
  serverName: string,
  workspaceFolder: vscode.WorkspaceFolder,
): Record<string, string> | undefined {
  if (value === undefined) {
    return undefined
  }

  if (
    !isRecord(value) ||
    Object.values(value).some(item => typeof item !== 'string')
  ) {
    throw new Error(`MCP server ${serverName}.${key} must be a string object.`)
  }

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      expandVariables(entryValue as string, workspaceFolder),
    ]),
  )
}

function expandVariables(
  value: string,
  workspaceFolder: vscode.WorkspaceFolder,
): string {
  return value.replaceAll('${workspaceFolder}', workspaceFolder.uri.fsPath)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidServerName(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value)
}
