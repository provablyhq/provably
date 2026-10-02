import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLedger, serializeEvent, hashContent, type LedgerEvent } from "./ledger.js";

const sampleEvent: LedgerEvent = {
  v: 1,
  id: "00000000-0000-0000-0000-000000000000",
  ts: "2026-10-02T12:00:00.000Z",
  tool: "claude-code",
  model: "claude-opus-4-8",
  file: "src/foo.ts",
  contentSha256: hashContent("hello"),
  aiRanges: [[0, 5]],
};

test("serialize then parse round-trips an event", () => {
  const jsonl = serializeEvent(sampleEvent);
  const [parsed] = parseLedger(jsonl);
  assert.deepEqual(parsed, sampleEvent);
});

test("parseLedger skips blank lines", () => {
  const jsonl = `${serializeEvent(sampleEvent)}\n\n${serializeEvent(sampleEvent)}\n`;
  assert.equal(parseLedger(jsonl).length, 2);
});

test("parseLedger rejects an unsupported schema version", () => {
  const badLine = JSON.stringify({ ...sampleEvent, v: 2 });
  assert.throws(() => parseLedger(badLine), /unsupported schema version/);
});

test("parseLedger rejects a malformed range", () => {
  const badLine = JSON.stringify({ ...sampleEvent, aiRanges: [[5, 1]] });
  assert.throws(() => parseLedger(badLine), /aiRanges/);
});

test("hashContent is deterministic and content-sensitive", () => {
  assert.equal(hashContent("abc"), hashContent("abc"));
  assert.notEqual(hashContent("abc"), hashContent("abd"));
});
