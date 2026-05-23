import { build, type BuildOptions } from 'esbuild'

const production = process.argv.includes('--production')

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

try {
  await build(config)
} catch (err: unknown) {
  console.error(err)
  process.exit(1)
}
