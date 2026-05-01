import esbuild from 'esbuild'

const production = process.argv.includes('--production')
const watch = process.argv.includes('--watch')

const config: import('esbuild').BuildOptions = {
  bundle: true,
  entryPoints: ['extension/extension.ts'],
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

async function main(): Promise<void> {
  if (watch) {
    const context = await esbuild.context(config)
    await context.watch()
    console.log('Watching extension sources...')
    return
  }

  await esbuild.build(config)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
