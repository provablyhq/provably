import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDuration } from "./format-duration.js";

test("formatDuration picks the largest sensible unit", () => {
  assert.equal(formatDuration(40), "40ms");
  assert.equal(formatDuration(12_000), "12s");
  assert.equal(formatDuration(125_000), "2m 5s");
});
