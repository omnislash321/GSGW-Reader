#!/usr/bin/env node
// Dev watcher: build once, serve website/, and rebuild on every source change.
// Source dirs are read by build.mjs at runtime, so a rebuild is all that's needed —
// the static server keeps serving the freshly-written files (just refresh the browser).
import { spawn } from "node:child_process";
import { watch } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { build } from "./build.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// Inputs build() reads. Not scripts/ — Node caches imported modules, so editing the
// build code itself won't take effect until you restart `npm run watch`.
const WATCH = ["chapters", "templates", "assets", "site.json"];

function rebuild() {
  try {
    build();
  } catch (err) {
    console.error("Build failed:", err.message); // keep watching; fix and re-save
  }
}

rebuild();

// Static file server (separate process; static assets need no restart on rebuild).
// Single shell string (not args+shell) to avoid Node's DEP0190 warning.
spawn(`npx serve "${join(ROOT, "website")}"`, { stdio: "inherit", shell: true });

let timer = null;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(rebuild, 100); // debounce — editors emit several events per save
}

for (const p of WATCH) {
  watch(join(ROOT, p), { recursive: true }, schedule);
}
console.log(`Watching ${WATCH.join(", ")} — rebuilding on change`);
