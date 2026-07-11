# Aria

Aria is a VS Code extension for AI-powered commit message generation.

## Features

Generate a commit message from staged changes.

If nothing is staged, Aria uses working tree changes and a small summary of untracked files.

## Configuration

Aria supports DeepSeek, OpenAI, and OpenAI-compatible providers.

Set these in VS Code settings:

- `aria.api.provider`
- `aria.api.apiKeys.deepseek`
- `aria.api.apiKeys.openai`
- `aria.api.apiKeys.openai-compatible`
- `aria.api.baseURLs.openai-compatible`
- `aria.api.reasoningEffort`

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
