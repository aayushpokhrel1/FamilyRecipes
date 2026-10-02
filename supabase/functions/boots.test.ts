import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import ts from "typescript";

// THE MECHANICAL GUARD THIS FUNCTION NEEDS, and did not have.
//
// `npx supabase functions deploy` does NOT typecheck or even parse what it uploads, and the
// edge runtime only finds out when a request arrives, so a bad file ships silently and then
// answers 503 BOOT_ERROR on EVERY mode: text, url, image and audio at once. That has happened
// once already, from a duplicate `const body` declaration.
//
// index.ts carried a comment claiming "`npm test` now parses this file for exactly that". It
// did not: on 2026-09-30 nothing in the suite read this directory at all, so the only
// protection was a sentence asserting protection. This file makes the claim true.
//
// Vitest cannot IMPORT these modules (they are Deno: remote URL imports, Deno.serve, .ts
// specifiers) and `tsc -b` deliberately excludes them for the same reason. So this checks the
// two classes that stop an isolate booting and need no module resolution to detect:
//   1. a syntax error, from the parser
//   2. a redeclared binding, which is NOT a syntax error and needs the checker
// Everything else the checker says here is noise (cannot find `jsr:...`, `Deno` is not
// defined) and is filtered out, because those are facts about Deno, not faults in the code.

// This file sits in supabase/functions/, NOT inside one function, because it guards all of
// them. It used to live in extract-recipe/ and scan only its own directory.
const functionsRoot = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

// EVERY edge function, not just this one. This used to scan only extract-recipe, which meant
// the guard silently did not cover admin, delete-account or notify-report: each new function
// needed someone to remember to copy this file, and the whole lesson of this test is that
// nobody remembers. Walking the parent directory makes a new function covered the moment it
// exists, with no step to forget.
const sources = readdirSync(functionsRoot, { withFileTypes: true })
  .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
  .flatMap((e) =>
    readdirSync(join(functionsRoot, e.name))
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .map((f) => join(e.name, f)),
  )
  .sort();

// Only the codes that mean "this will not run". 2451 cannot redeclare block-scoped variable,
// 2300 duplicate identifier, 2393 duplicate function implementation, 2567 enum redeclared.
const FATAL_CODES = new Set([2300, 2393, 2451, 2567]);

function syntaxErrors(file: string, code: string): string[] {
  const parsed = ts.createSourceFile(file, code, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
  const diags = (parsed as unknown as { parseDiagnostics?: ts.Diagnostic[] }).parseDiagnostics ?? [];
  return diags.map((d) => {
    const at = d.start !== undefined
      ? ts.getLineAndCharacterOfPosition(parsed, d.start).line + 1
      : 0;
    return `${file}:${at} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
  });
}

// Runs the checker over ONE file in isolation, with resolution switched off, and keeps only
// the fatal codes above.
function redeclarations(code: string): string[] {
  const tmp = mkdtempSync(join(tmpdir(), "edge-boot-"));
  const path = join(tmp, "subject.ts");
  writeFileSync(path, code, "utf8");
  const program = ts.createProgram([path], {
    noResolve: true,
    noLib: true,
    skipLibCheck: true,
    allowJs: false,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
  });
  return program
    .getSemanticDiagnostics(program.getSourceFile(path))
    .filter((d) => FATAL_CODES.has(d.code))
    .map((d) => `TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
}

describe("the edge function parses and binds, so it can boot", () => {
  it("has sources to check, since a silently empty list would guard nothing", () => {
    expect(sources.length).toBeGreaterThan(0);
    // Named explicitly: if a function directory is renamed or dropped, this says so rather
    // than quietly checking fewer files than you think.
    expect(sources).toContain(join("extract-recipe", "index.ts"));
    expect(sources).toContain(join("admin", "index.ts"));
    expect(sources).toContain(join("delete-account", "index.ts"));
    expect(sources).toContain(join("notify-report", "index.ts"));
  });

  for (const file of sources) {
    it(`${file} has no syntax error`, () => {
      expect(syntaxErrors(file, readFileSync(join(functionsRoot, file), "utf8"))).toEqual([]);
    });

    it(`${file} redeclares nothing`, () => {
      expect(redeclarations(readFileSync(join(functionsRoot, file), "utf8"))).toEqual([]);
    });
  }

  // Proof the guard can actually fail. A check nobody has seen go red is not evidence, and
  // this is the exact shape of the bug that shipped: legal syntax, fatal at boot.
  it("catches the duplicate declaration that shipped once", () => {
    expect(syntaxErrors("broken.ts", "const body = 1;\nconst body = 2;\n")).toEqual([]);
    expect(redeclarations("const body = 1;\nconst body = 2;\n")).not.toEqual([]);
  });

  it("catches a plain syntax error too", () => {
    expect(syntaxErrors("broken.ts", "function f( { return 1 }\n")).not.toEqual([]);
  });

  // Deno-isms must NOT be reported, or the guard cries wolf and gets deleted.
  it("ignores Deno globals and remote imports", () => {
    const denoish = 'import { x } from "jsr:@scope/pkg@2";\nconst v = Deno.env.get("A");\nexport { x, v };\n';
    expect(syntaxErrors("denoish.ts", denoish)).toEqual([]);
    expect(redeclarations(denoish)).toEqual([]);
  });
});
