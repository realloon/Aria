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
3. In the Extension Development Host, run `Aria: Hello World` from the command palette.

## Agent Chat

The Aria activity bar item opens the Agent Chat panel.

Before sending messages:

1. Run `Aria: Set API Key` from the command palette, or click `Key` in the chat panel.
2. Configure `aria.api.model` in VS Code Settings.
3. Configure `aria.api.baseUrl` in VS Code Settings if you are not using the default OpenAI-compatible endpoint.

## Current Contribution

- Command: `Aria: Hello World`
- Command: `Aria: Set API Key`
- Command: `Aria: Clear API Key`
- View: `Aria > Chat`
- Command id: `aria.helloWorld`
