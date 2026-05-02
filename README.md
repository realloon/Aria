# Aria

Aria is a programming agent extension scaffold for VS Code.

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

## Current Contribution

- Command: `Aria: Open Settings`
- Command: `Aria: Show FIM Context`
- Keybinding: `Cmd+Option+K` triggers FIM inline completion.
- View: `Aria > Chat`
- Inline completion: FIM completion uses the selected provider when it supports a default FIM model. When available, Aria adds compact VS Code symbol context from the current document and workspace symbol providers.
