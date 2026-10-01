import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { FleetAlert } from "./fleet-model";
import { forgetResolvedAfterMs, notificationState, pauseForMs, selectNotifiable } from "./notification-policy";

const alert = (key: string): FleetAlert => ({
  key,
  clusterId: "c1",
  source: "pod",
  severity: "critical",
  title: "CrashLoopBackOff",
  detail: "",
  target: { type: "cluster" },
});

const now = Date.parse("2026-10-01T08:00:00Z");
const ready = { silenced: false, warmingUp: () => false };

describe("notificationState", () => {
  test("on by default, paused until a time, off until turned back on", () => {
    assert.deepEqual(notificationState({ off: false }, now), { kind: "on" });
    assert.deepEqual(notificationState({ off: false, pausedUntil: now + pauseForMs }, now), { kind: "paused", until: now + pauseForMs });
    assert.deepEqual(notificationState({ off: true, pausedUntil: now + pauseForMs }, now), { kind: "off" });
  });

  test("a pause that ended is on again", () => {
    assert.deepEqual(notificationState({ off: false, pausedUntil: now - 1 }, now), { kind: "on" });
  });
});

describe("selectNotifiable", () => {
  test("a new critical alert is notified once", () => {
    const seen = new Map<string, number>();

    assert.equal(selectNotifiable([alert("a")], seen, { now, ...ready }).length, 1);
    assert.equal(selectNotifiable([alert("a")], seen, { now: now + 30_000, ...ready }).length, 0);
  });

  test("while silenced nothing is notified, and the end of the pause brings no flood of what happened in it", () => {
    const seen = new Map<string, number>();

    assert.deepEqual(selectNotifiable([alert("a"), alert("b")], seen, { now, silenced: true, warmingUp: () => false }), []);
    assert.deepEqual(selectNotifiable([alert("a"), alert("b")], seen, { now: now + 60_000, ...ready }), []);
    assert.deepEqual(
      selectNotifiable([alert("a"), alert("b"), alert("c")], seen, { now: now + 120_000, ...ready }).map((one) => one.key),
      ["c"],
    );
  });

  test("what a cluster had when it started being watched is not notified", () => {
    const seen = new Map<string, number>();

    assert.deepEqual(selectNotifiable([alert("a")], seen, { now, silenced: false, warmingUp: () => true }), []);
    assert.deepEqual(selectNotifiable([alert("a")], seen, { now: now + 90_000, ...ready }), []);
  });

  test("an alert back within ten minutes is the same problem; after that it notifies again", () => {
    const seen = new Map<string, number>();

    selectNotifiable([alert("a")], seen, { now, ...ready });
    selectNotifiable([], seen, { now: now + 60_000, ...ready });
    assert.equal(selectNotifiable([alert("a")], seen, { now: now + 5 * 60_000, ...ready }).length, 0);

    selectNotifiable([], seen, { now: now + 5 * 60_000 + forgetResolvedAfterMs + 1, ...ready });
    assert.equal(selectNotifiable([alert("a")], seen, { now: now + 30 * 60_000, ...ready }).length, 1);
  });
});
