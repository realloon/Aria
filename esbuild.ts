import { build, context, type BuildOptions } from 'esbuild'

const production = process.argv.includes('--production')
const watch = process.argv.includes('--watch')

const config: BuildOptions = {
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  bundle: true,
  entryPoints: ['src/extension/extension.ts'],
  external: ['vscode'],
  format: 'esm',
  logLevel: 'info',
  minify: production,
  outfile: 'dist/extension.js',
  platform: 'node',
  sourcemap: !production,
  sourcesContent: false,
  target: 'node20',
}

async function main() {
  if (watch) {
    const buildContext = await context(config)
    await buildContext.watch()
    console.log('Watching extension sources...')
    return
  }

  await build(config)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
