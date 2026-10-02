import type { CharRange } from "./ledger.js";

export interface BuiltDocument {
  readonly content: string;
  readonly aiRanges: CharRange[];
}

export type Segment = string | { readonly ai: string };

export function buildDocument(segments: Segment[]): BuiltDocument {
  let content = "";
  const aiRanges: CharRange[] = [];
  for (const segment of segments) {
    if (typeof segment === "string") {
      content += segment;
      continue;
    }
    const start = content.length;
    content += segment.ai;
    aiRanges.push([start, content.length]);
  }
  return { content, aiRanges };
}

export type TransformationCategory =
  | "identity"
  | "reformat"
  | "human-insert"
  | "human-edit-around-ai"
  | "delete-ai"
  | "move-block"
  | "interleave"
  | "collision"
  | "verbatim-collision"
  | "rename";

export interface Scenario {
  readonly name: string;
  readonly category: TransformationCategory;
  readonly base: BuiltDocument;
  readonly head: BuiltDocument;
}

const aiLoopBody =
  "  let total = 0;\n  for (const item of items) {\n    total += item.price * item.quantity;\n  }\n";

export const baselineScenarios: Scenario[] = [
  {
    name: "identity: head equals base",
    category: "identity",
    base: buildDocument(["function totalPrice(items) {\n", { ai: aiLoopBody }, "  return total;\n}\n"]),
    head: buildDocument(["function totalPrice(items) {\n", { ai: aiLoopBody }, "  return total;\n}\n"]),
  },
  {
    name: "reformat: AI block reindented and brace moved",
    category: "reformat",
    base: buildDocument(["function totalPrice(items){\n", { ai: aiLoopBody }, "  return total;\n}\n"]),
    head: buildDocument([
      "function totalPrice(items) {\n",
      {
        ai: "        let total = 0;\n        for (const item of items)\n        {\n            total += item.price * item.quantity;\n        }\n",
      },
      "  return total;\n}\n",
    ]),
  },
  {
    name: "human-insert: human adds a tax line after AI body",
    category: "human-insert",
    base: buildDocument(["function totalPrice(items) {\n", { ai: aiLoopBody }, "  return total;\n}\n"]),
    head: buildDocument([
      "function totalPrice(items, taxRate) {\n",
      { ai: aiLoopBody },
      "  const taxed = total * (1 + taxRate);\n  return taxed;\n}\n",
    ]),
  },
  {
    name: "human-edit-around-ai: human rewrites signature, AI body untouched",
    category: "human-edit-around-ai",
    base: buildDocument(["function totalPrice(items) {\n", { ai: aiLoopBody }, "  return total;\n}\n"]),
    head: buildDocument([
      "export const totalPrice = (items: LineItem[]): number => {\n",
      { ai: aiLoopBody },
      "  return total;\n};\n",
    ]),
  },
  {
    name: "delete-ai: half of the AI block removed by human",
    category: "delete-ai",
    base: buildDocument(["function totalPrice(items) {\n", { ai: aiLoopBody }, "  return total;\n}\n"]),
    head: buildDocument([
      "function totalPrice(items) {\n",
      { ai: "  let total = 0;\n" },
      "  return total;\n}\n",
    ]),
  },
  {
    name: "move-block: AI body moved below a new human guard clause",
    category: "move-block",
    base: buildDocument(["function totalPrice(items) {\n", { ai: aiLoopBody }, "  return total;\n}\n"]),
    head: buildDocument([
      "function totalPrice(items) {\n  if (!items) {\n    return 0;\n  }\n",
      { ai: aiLoopBody },
      "  return total;\n}\n",
    ]),
  },
  {
    name: "interleave: human log lines inserted inside the AI loop",
    category: "interleave",
    base: buildDocument(["function totalPrice(items) {\n", { ai: aiLoopBody }, "  return total;\n}\n"]),
    head: buildDocument([
      "function totalPrice(items) {\n",
      { ai: "  let total = 0;\n  for (const item of items) {\n" },
      "    console.log(item);\n",
      { ai: "    total += item.price * item.quantity;\n  }\n" },
      "  return total;\n}\n",
    ]),
  },
];

export const adversarialScenarios: Scenario[] = [
  {
    name: "collision: AI logging deleted, human adds similar logging",
    category: "collision",
    base: buildDocument(["function h() {\n", { ai: "  log('a');\n  log('b');\n" }, "}\n"]),
    head: buildDocument(["function h() {\n", "  log('c');\n", "}\n"]),
  },
  {
    name: "verbatim-collision: human reproduces an AI line byte-for-byte",
    category: "verbatim-collision",
    base: buildDocument([
      "function pick(values) {\n",
      { ai: "  if (values.length === 0) {\n    return null;\n  }\n" },
      "  return values[0];\n}\n",
    ]),
    head: buildDocument(["function pick(values) {\n", "  return null;\n}\n"]),
  },
  {
    name: "rename: human renames AI identifiers, logic unchanged",
    category: "rename",
    base: buildDocument([
      "function area(r) {\n",
      { ai: "  const radius = r;\n  const result = radius * radius * 3.14;\n  return result;\n" },
      "}\n",
    ]),
    head: buildDocument([
      "function area(r) {\n",
      { ai: "  const rad = r;\n  const out = rad * rad * 3.14;\n  return out;\n" },
      "}\n",
    ]),
  },
  {
    name: "move-block: AI block relocated past identical human boilerplate",
    category: "move-block",
    base: buildDocument([
      "const config = {\n  a: 1,\n  b: 2,\n};\n",
      { ai: "function compute(x) {\n  return x * x;\n}\n" },
      "const other = {\n  a: 1,\n  b: 2,\n};\n",
    ]),
    head: buildDocument([
      "const config = {\n  a: 1,\n  b: 2,\n};\n",
      "const other = {\n  a: 1,\n  b: 2,\n};\n",
      { ai: "function compute(x) {\n  return x * x;\n}\n" },
    ]),
  },
];

export const scenarios: Scenario[] = [...baselineScenarios, ...adversarialScenarios];
