# Aria

Aria is a programming agent extension for VS Code.

## Feature



## Development

Install dependencies:

```sh
pnpm install
```

Build the extension:

```sh
pnpm run compile
```

Run it in VS Code:

1. Open this folder in VS Code.
2. Press `F5` and choose `Run Extension`.
3. In the Extension Development Host, open the Aria activity bar item.

## Agent Chat

The Aria activity bar item opens the Agent Chat panel.

Before sending messages:

1. Configure `aria.api.provider` in VS Code Settings.
2. Configure the API key for that provider in VS Code Settings:
   - `aria.api.apiKeys.deepseek`
   - `aria.api.apiKeys.openai`
   - `aria.api.apiKeys.openai-compatible`
3. Configure `aria.api.baseURLs.openai-compatible` when using `openai-compatible`.

Supported providers are `deepseek`, `openai`, and `openai-compatible`. Aria
selects the default chat and FIM model for the chosen provider.

### MCP

Aria reads MCP servers from `./.agents/mcp.json` in the workspace root:

```json
{
  "mcpServers": {
    "server_name": {
      "command": "node",
      "args": ["./server.js"],
      "env": {
        "TOKEN": "value"
      }
    }
  }
}
```

Use `url` instead of `command` for Streamable HTTP servers.

Tool names are exposed to the model as `source__tool_name`. Built-in tools use
`buildin` as the source, for example `buildin__read_file`.

## Current Contribution

- Command: `Aria: Show FIM Context`
- Keybinding: `Cmd+Option+K` triggers FIM inline completion.
- View: `Aria > Chat`
- Inline completion: FIM completion uses the selected provider when it supports a default FIM model. When available, Aria adds compact VS Code symbol context from the current document and workspace symbol providers.
