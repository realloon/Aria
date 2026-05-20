# Aria

Aria is a coding agent extension for VS Code.

## Feature

### Agent Chat

Chat with Aria from the Activity Bar.

Aria can read and edit files, apply patches, run commands, and ask for input
when a task needs a decision.

### Auto Completion

Inline FIM completion for the active editor.

Trigger VS Code inline suggestions with `Cmd+Alt+K`, or use the editor's normal
inline suggestion flow.

### Generate Commit

Generate a commit message from staged changes.

If nothing is staged, Aria uses working tree changes and a small summary of
untracked files.

## Configuration

Aria supports DeepSeek, OpenAI, and OpenAI-compatible providers.

Set these in VS Code settings:

- `aria.api.provider`
- `aria.api.apiKeys.deepseek`
- `aria.api.apiKeys.openai`
- `aria.api.apiKeys.openai-compatible`
- `aria.api.baseURLs.openai-compatible`
- `aria.api.reasoningEffort`
- `aria.fim.enabled`
- `aria.fim.maxTokens`

## Connect

### AGENTS.md

Aria reads [AGENTS.md](https://agents.md) from `AGENTS.md` in the workspace root.

### MCP

Aria reads [MCP](https://modelcontextprotocol.io) servers from `.agents/mcp.json` in the workspace root:

```json
{
  "mcpServers": {
    "server_name": {
      "command": "node",
      "args": ["server.js"]
    }
  }
}
```

Use `url` instead of `command` for Streamable HTTP servers.

### Agent Skills

Not supported yet.

## Development

Install dependencies:

```sh
pnpm install
```

Build the extension:

```sh
pnpm run compile
```

Package the extension:

```sh
pnpm run build
```
