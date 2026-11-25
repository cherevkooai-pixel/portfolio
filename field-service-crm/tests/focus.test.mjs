import { test } from "node:test";
import assert from "node:assert/strict";
import { WEEK, PILLARS, focusFor, focusMessage } from "../src/server/focus.ts";

test("every day has exactly 3 tasks, each tied to a real pillar", () => {
  for (const day of WEEK) {
    assert.equal(day.length, 3);
    for (const [p, t] of day) { assert.ok(PILLARS[p], `pillar ${p}`); assert.ok(t.length > 5); }
  }
  assert.equal(PILLARS.length, 8);
  for (const [, acts] of PILLARS) assert.equal(acts.length, 8);
});

test("each date gets its weekday's tasks", () => {
  assert.deepEqual(focusFor("2026-11-16"), WEEK[1]);              // Monday
  assert.deepEqual(focusFor("2026-11-15"), WEEK[0]);              // Sunday
  assert.match(focusMessage("2026-11-12"), /^🎯 3 tasks · Thu, Nov 12/);
});
