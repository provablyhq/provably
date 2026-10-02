import { test } from "node:test";
import assert from "node:assert/strict";
import { isTypeScriptFile, typeOnlyLines } from "./type-only.js";

function typeOnlyTexts(content: string): string[] {
  const lines = content.split("\n");
  return [...typeOnlyLines(content)].sort((left, right) => left - right).map((lineNumber) => lines[lineNumber - 1]!);
}

test("marks interfaces, type aliases, type imports and declare blocks", () => {
  const content = [
    'import type { LedgerEvent } from "./ledger.js";',
    'import { readFileSync } from "node:fs";',
    "export interface Finding {",
    "  readonly file: string;",
    "  readonly nested: { start: number };",
    "}",
    "type Tier =",
    '  | "high"',
    '  | "standard";',
    'export type { Finding as Result } from "./x.js";',
    "declare global {",
    "  var flag: boolean;",
    "}",
    "export function run(event: LedgerEvent): Tier {",
    '  return "high";',
    "}",
  ].join("\n");
  assert.deepEqual(typeOnlyTexts(content), [
    'import type { LedgerEvent } from "./ledger.js";',
    "export interface Finding {",
    "  readonly file: string;",
    "  readonly nested: { start: number };",
    "}",
    "type Tier =",
    '  | "high"',
    '  | "standard";',
    'export type { Finding as Result } from "./x.js";',
    "declare global {",
    "  var flag: boolean;",
    "}",
  ]);
});

test("a type alias without a semicolon ends at the line break", () => {
  const content = "type Id = string\nconst id: Id = makeId()\n";
  assert.deepEqual(typeOnlyTexts(content), ["type Id = string"]);
});

test("runtime code that mentions the keywords is never marked", () => {
  const content = [
    "const type = 3;",
    'const record = { type: "x", interface: 1 };',
    "const text = `interface ${record.type} {`;",
    "const pattern = /type X = {/;",
    "// interface Ghost {",
    "const value = import(\"./type\");",
    "import { type Mixed, runtimeValue } from \"./m.js\";",
  ].join("\n");
  assert.deepEqual(typeOnlyTexts(content), []);
});

test("an interface split across lines before its brace stays whole", () => {
  const content = "interface Big\n  extends Base<string> {\n  field: number;\n}\nexport const after = 1;\n";
  assert.deepEqual(typeOnlyTexts(content), ["interface Big", "  extends Base<string> {", "  field: number;", "}"]);
});

test("isTypeScriptFile", () => {
  assert.equal(isTypeScriptFile("src/a.ts"), true);
  assert.equal(isTypeScriptFile("src/a.tsx"), true);
  assert.equal(isTypeScriptFile("src/a.js"), false);
});
