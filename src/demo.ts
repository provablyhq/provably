import { randomUUID } from "node:crypto";
import { hashContent, labelsFromRanges, type LedgerEvent } from "./ledger.js";
import { propagateLabels } from "./propagate.js";
import { rollupByLine } from "./lines.js";

const authoredContent = `export function totalPrice(items) {
  let total = 0;
  for (const item of items) {
    total += item.price * item.quantity;
  }
  return total;
}
`;

const aiBodyStart = authoredContent.indexOf("  let total = 0;");
const aiBodyEnd = authoredContent.indexOf("  }\n", aiBodyStart) + "  }".length;

const captureEvent: LedgerEvent = {
  v: 1,
  id: randomUUID(),
  ts: new Date().toISOString(),
  tool: "claude-code",
  model: "claude-opus-4-8",
  file: "src/pricing.js",
  contentSha256: hashContent(authoredContent),
  aiRanges: [[aiBodyStart, aiBodyEnd]],
};

const prHeadContent = `export function totalPrice(items, taxRate) {
  let total = 0;
  for (const item of items) {
    total += item.price * item.quantity;
  }
  const taxed = total * (1 + taxRate);
  return taxed;
}
`;

const authoredLabels = labelsFromRanges(authoredContent, captureEvent.aiRanges);
const propagation = propagateLabels(authoredContent, authoredLabels, prHeadContent);
const lines = rollupByLine(prHeadContent, propagation.tokens);

console.log("Capture anchor");
console.log(`  file:          ${captureEvent.file}`);
console.log(`  model:         ${captureEvent.model}`);
console.log(`  contentSha256: ${captureEvent.contentSha256.slice(0, 16)}...`);
console.log(`  aiRanges:      ${JSON.stringify(captureEvent.aiRanges)}`);
console.log("");
console.log(`Propagated to PR head: carried ${propagation.carriedCount} AI tokens, ${propagation.insertedCount} new tokens default to not-AI`);
console.log("");
console.log("Per-line provenance at PR head");
for (const line of lines) {
  const marker = line.aiRatio >= 0.5 ? "AI " : line.aiTokenCount > 0 ? "mix" : "   ";
  const ratio = `${Math.round(line.aiRatio * 100)}%`.padStart(4);
  console.log(`  ${String(line.lineNumber).padStart(2)} ${marker} ${ratio}  ${line.text}`);
}
