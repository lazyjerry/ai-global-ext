require("esbuild").buildSync({
  entryPoints: ["src/extension.cjs"],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["vscode"],
  outfile: "out/extension.js",
});
