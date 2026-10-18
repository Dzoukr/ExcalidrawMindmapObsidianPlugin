import esbuild from "esbuild";
import { builtinModules } from "node:module";
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";

const prod = process.argv[2] === "production";
// Dev builds are copied into the test vault so Obsidian picks them up.
const testPluginDir = join("test-vault", ".obsidian", "plugins", "excalidraw-mindmap");

const copyToTestVault = {
  name: "copy-to-test-vault",
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length || !existsSync("test-vault")) return;
      mkdirSync(testPluginDir, { recursive: true });
      for (const f of ["main.js", "manifest.json", "styles.css"]) copyFileSync(f, join(testPluginDir, f));
      writeFileSync(join(testPluginDir, ".hotreload"), "");
      console.log(`[${new Date().toLocaleTimeString()}] copied to test vault`);
    });
  },
};

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules],
  format: "cjs",
  target: "es2020",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  plugins: [copyToTestVault],
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
