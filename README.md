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

1. Configure `aria.api.apiKey` in VS Code Settings.
2. Configure `aria.api.model` in VS Code Settings.
3. Configure `aria.api.baseUrl` in VS Code Settings if you are not using the default OpenAI-compatible endpoint.

## Current Contribution

- Command: `Aria: Open Settings`
- View: `Aria > Chat`
- Inline completion: FIM completion through `aria.fim.*` settings. For DeepSeek, Aria routes `https://api.deepseek.com` to `https://api.deepseek.com/beta` automatically.
