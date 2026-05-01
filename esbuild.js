const esbuild = require("esbuild");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

/** @type {import("esbuild").BuildOptions} */
const config = {
  bundle: true,
  entryPoints: ["src/extension.ts"],
  external: ["vscode"],
  format: "cjs",
  logLevel: "info",
  minify: production,
  outfile: "dist/extension.js",
  platform: "node",
  sourcemap: !production,
  sourcesContent: false,
  target: "node20"
};

async function main() {
  if (watch) {
    const context = await esbuild.context(config);
    await context.watch();
    console.log("Watching extension sources...");
    return;
  }

  await esbuild.build(config);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
