import { test } from "node:test";
import assert from "node:assert/strict";
import {
  areaForModule,
  assessPathRisk,
  callEvidenceForLines,
  fileRiskContext,
  fileRole,
  findingRisk,
  isLogicLine,
  matchesGlob,
  parseImports,
  parseRiskConfig,
} from "./risk.js";

test("assessPathRisk matches whole path words, not substrings", () => {
  assert.equal(assessPathRisk("src/auth/session.ts")?.area, "auth");
  assert.equal(assessPathRisk("src/paymentGateway.ts")?.area, "payments");
  assert.equal(assessPathRisk("db/0042_add_users.sql")?.area, "migrations");
  assert.equal(assessPathRisk("src/authors.ts"), null);
  assert.equal(assessPathRisk("src/tokenize.ts"), null);
});

test("areaForModule matches packages, scopes and submodules but not lookalikes", () => {
  assert.equal(areaForModule("stripe"), "payments");
  assert.equal(areaForModule("@stripe/stripe-js"), "payments");
  assert.equal(areaForModule("passport-google-oauth20"), "auth");
  assert.equal(areaForModule("django.contrib.auth.hashers"), "auth");
  assert.equal(areaForModule("node:crypto"), "security");
  assert.equal(areaForModule("stripe-mock-helpers"), null);
  assert.equal(areaForModule("cryptocurrency-icons"), null);
  assert.equal(areaForModule("lodash"), null);
});

test("parseImports reads JavaScript default, named, namespace and require bindings", () => {
  const content = [
    'import Stripe from "stripe";',
    'import { sign, verify as verifyToken } from "jsonwebtoken";',
    'import * as nodeCrypto from "node:crypto";',
    'import type { Session } from "next-auth";',
    "import {",
    "  hash,",
    "  compare,",
    '} from "bcrypt";',
    'const argon = require("argon2");',
    'import "./polyfills";',
  ].join("\n");
  const bindings = parseImports("src/a.ts", content);
  const byModule = new Map(bindings.map((binding) => [binding.moduleName, binding]));
  assert.deepEqual(byModule.get("stripe")?.localNames, ["Stripe"]);
  assert.deepEqual(byModule.get("jsonwebtoken")?.localNames, ["sign", "verifyToken"]);
  assert.deepEqual(byModule.get("node:crypto")?.localNames, ["nodeCrypto"]);
  assert.equal(byModule.has("next-auth"), false, "type-only imports never run, so they are not evidence");
  assert.deepEqual(byModule.get("bcrypt")?.localNames, ["hash", "compare"]);
  assert.equal(byModule.get("bcrypt")?.line, 5);
  assert.deepEqual(byModule.get("argon2")?.localNames, ["argon"]);
  assert.deepEqual(byModule.get("./polyfills")?.localNames, []);
});

test("parseImports reads Python plain, aliased, from and parenthesized imports", () => {
  const content = [
    "import stripe",
    "import jwt as pyjwt, os",
    "from passlib.hash import bcrypt  # hashing",
    "from alembic import (",
    "    op,",
    "    context as alembic_context,",
    ")",
  ].join("\n");
  const bindings = parseImports("app/billing.py", content);
  const byModule = new Map(bindings.map((binding) => [binding.moduleName, binding]));
  assert.deepEqual(byModule.get("stripe")?.localNames, ["stripe"]);
  assert.deepEqual(byModule.get("jwt")?.localNames, ["pyjwt"]);
  assert.deepEqual(byModule.get("passlib.hash")?.localNames, ["bcrypt"]);
  assert.deepEqual(byModule.get("alembic")?.localNames, ["op", "alembic_context"]);
  assert.equal(byModule.get("alembic")?.line, 4);
});

test("call evidence follows a binding through one assignment", () => {
  const content = 'import Stripe from "stripe";\nthis.payments = new Stripe(key);\nawait this.payments.refunds.create({ charge });\n';
  const context = fileRiskContext("src/orders.ts", content);
  const evidence = callEvidenceForLines(context, [{ lineNumber: 3, text: "await this.payments.refunds.create({ charge });" }]);
  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.area, "payments");
  assert.match(evidence[0]!.detail, /`this\.payments\.refunds\.create`/);
});

test("call evidence ignores comments, import lines and property names that only look alike", () => {
  const content = 'import jwt from "jsonwebtoken";\nconst token = config.jwt;\n// jwt.sign is deprecated here\n';
  const context = fileRiskContext("src/util.ts", content);
  const lines = [
    { lineNumber: 1, text: 'import jwt from "jsonwebtoken";' },
    { lineNumber: 2, text: "const token = config.jwt;" },
    { lineNumber: 3, text: "// jwt.sign is deprecated here" },
  ];
  assert.deepEqual(callEvidenceForLines(context, lines), []);
});

test("SQL schema changes on a flagged line are high risk anywhere", () => {
  const context = fileRiskContext("src/db/setup.ts", "export const up = () => run(`ALTER TABLE users ADD COLUMN age int`);\n");
  const risk = findingRisk(context, [{ lineNumber: 1, text: "export const up = () => run(`ALTER TABLE users ADD COLUMN age int`);" }]);
  assert.equal(risk.tier, "high");
  assert.equal(risk.area, "migrations");
});

test("tiers: line-level calls are high, file-level imports and path words are only elevated", () => {
  const content = 'import bcrypt from "bcrypt";\nexport const check = (password, digest) => bcrypt.compare(password, digest);\nexport const label = "Sign in";\n';
  const context = fileRiskContext("src/helpers.ts", content);
  assert.equal(findingRisk(context, [{ lineNumber: 2, text: "export const check = (password, digest) => bcrypt.compare(password, digest);" }]).tier, "high");
  const labelRisk = findingRisk(context, [{ lineNumber: 3, text: 'export const label = "Sign in";' }]);
  assert.equal(labelRisk.tier, "elevated");
  assert.equal(labelRisk.evidence[0]?.detail, "imports `bcrypt`");
  assert.equal(findingRisk(fileRiskContext("src/format.ts", "export const x = 1;\n"), [{ lineNumber: 1, text: "export const x = 1;" }]).tier, "standard");
});

test("parseRiskConfig validates shape and matchesGlob follows the documented rules", () => {
  const config = parseRiskConfig(JSON.stringify({ risk: { areas: { payments: ["src/orders/**"] }, notRisky: ["src/auth/*.css.ts"] } }));
  assert.deepEqual(config.areas, [{ area: "payments", patterns: ["src/orders/**"] }]);
  assert.deepEqual(parseRiskConfig("{}"), { areas: [], notRisky: [] });
  assert.throws(() => parseRiskConfig("{ nope"), /not valid JSON/);
  assert.throws(() => parseRiskConfig(JSON.stringify({ risk: { areas: { payments: "src" } } })), /list of path globs/);

  assert.equal(matchesGlob("src/orders/**", "src/orders/a/b.ts"), true);
  assert.equal(matchesGlob("src/*.ts", "src/a.ts"), true);
  assert.equal(matchesGlob("src/*.ts", "src/nested/a.ts"), false);
  assert.equal(matchesGlob("**/billing/**", "packages/api/billing/charge.ts"), true);
  assert.equal(matchesGlob("**/billing/**", "billing/charge.ts"), true);
  assert.equal(matchesGlob("src/orders/", "src/orders/x.ts"), true);
  assert.equal(matchesGlob("src/order?.ts", "src/orders.ts"), true);
});

test("fileRole keeps only non-test source files in scope", () => {
  assert.equal(fileRole("src/pr-check.ts"), "source");
  assert.equal(fileRole("src/pr-check.test.ts"), "test");
  assert.equal(fileRole("tests/test_billing.py"), "test");
  assert.equal(fileRole("pkg/server_test.go"), "test");
  assert.equal(fileRole("docs/propagation.md"), "other");
  assert.equal(fileRole("package.json"), "other");
});

test("isLogicLine separates branching code from plain statements", () => {
  assert.equal(isLogicLine("  if (total > limit) {"), true);
  assert.equal(isLogicLine("  return a ?? b;"), true);
  assert.equal(isLogicLine("  const items: Array<string> = [];"), false);
  assert.equal(isLogicLine("  log(value);"), false);
});
