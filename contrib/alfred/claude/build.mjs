#!/usr/bin/env node
// Builds the self-contained Claude artifact from claude/index.html: inlines ../public/hud.css and
// turns ../public/voice.mjs + hud.mjs into in-page modules, so the published page loads no files.
//
//   node contrib/alfred/claude/build.mjs [saída.html]   (padrão: contrib/alfred/claude/dist/alfred.html)

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "..", "public");

/** `export const a…; export function b…` → `const __x = (() => { …; return { a, b }; })();` */
export function inlineModule(id, code) {
  if (/^\s*import\s/m.test(code)) throw new Error(`${id}: imports inside inlined modules are not supported`);
  const names = [
    ...code.matchAll(/^export\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/gm),
  ].map((m) => m[1]);
  const body = code.replace(/^export\s+/gm, "");
  return `const __${id} = (() => {\n${body}\nreturn { ${names.join(", ")} };\n})();`;
}

export function build(html, read = (file) => readFileSync(join(PUBLIC, file), "utf8")) {
  const modules = [];
  let out = html.replace(/<link rel="stylesheet" href="hud\.css" \/>/, () => `<style>\n${read("hud.css")}\n</style>`);
  out = out.replace(/^(\s*)import\s*\{([^}]+)\}\s*from\s*"\.\/(\w+)\.mjs";$/gm, (_, indent, names, file) => {
    modules.push(inlineModule(file, read(`${file}.mjs`)));
    return `${indent}const {${names}} = __${file};`;
  });
  if (/href="hud\.css"|from "\.\//.test(out)) throw new Error("build: an import or stylesheet was not inlined");
  return out.replace('<script type="module">', () => `<script type="module">\n${modules.join("\n")}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const target = process.argv[2] || join(HERE, "dist", "alfred.html");
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, build(readFileSync(join(HERE, "index.html"), "utf8")));
  console.log(`Artifact pronto: ${target}`);
}
