import { scenarios } from "./scenarios.js";
import { gradeAllWithGit } from "./grade-git.js";
import { aiLinePrecision, aiLineRecall, falseFlagRate, type GradeTotals } from "./grader.js";

const GATE_MAX_FALSE_FLAG_RATE = 0.01;
const GATE_MIN_AI_LINE_PRECISION = 0.9;

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`.padStart(7);
}

function reportRow(label: string, totals: GradeTotals): string {
  return [
    label.padEnd(26),
    percent(aiLinePrecision(totals)),
    percent(aiLineRecall(totals)),
    percent(falseFlagRate(totals)),
  ].join("  ");
}

const { results, overall, byCategory } = gradeAllWithGit(scenarios);

const header = ["scope".padEnd(26), "ai-line-prec", "ai-line-rec", "falseflag"].join("  ");

console.log("Grader: git-history-aware pipeline (content propagation + commit veto)");
console.log("");
console.log(header);
console.log("-".repeat(header.length));
for (const [category, totals] of byCategory) {
  console.log(reportRow(category, totals));
}
console.log("-".repeat(header.length));
console.log(reportRow("OVERALL", overall));
console.log("");

console.log("Per-scenario false flags (pure-human lines wrongly marked AI)");
for (const { scenario, totals } of results) {
  const marker = totals.pureHumanLinesFlagged === 0 ? "ok" : "FLAG";
  console.log(`  [${marker}] ${scenario.name}: ${totals.pureHumanLinesFlagged}/${totals.pureHumanLines}`);
}
console.log("");

const falseFlag = falseFlagRate(overall);
const aiPrecision = aiLinePrecision(overall);
const falseFlagPass = falseFlag <= GATE_MAX_FALSE_FLAG_RATE;
const precisionPass = aiPrecision >= GATE_MIN_AI_LINE_PRECISION;

console.log("Phase 0 gate");
console.log(`  false-flag rate on human code  ${percent(falseFlag)}  (target <= ${percent(GATE_MAX_FALSE_FLAG_RATE)})  ${falseFlagPass ? "PASS" : "FAIL"}`);
console.log(`  precision on AI lines          ${percent(aiPrecision)}  (target >= ${percent(GATE_MIN_AI_LINE_PRECISION)})  ${precisionPass ? "PASS" : "FAIL"}`);
console.log("");
console.log(falseFlagPass && precisionPass ? "GATE: PASS" : "GATE: FAIL");

process.exit(falseFlagPass && precisionPass ? 0 : 1);
