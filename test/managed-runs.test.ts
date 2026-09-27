import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getManagedRun,
  listManagedRuns,
  managedRunSummary,
  putManagedRun,
  removeManagedRun,
  resetManagedRunsForTest,
  type ManagedRun,
} from "../src/control/managedRuns";

function run(overrides: Partial<ManagedRun> = {}): ManagedRun {
  return {
    version: 1,
    serverKey: "local:test",
    sessionId: "ses_long",
    directory: "/tmp/project",
    boundaryMessageId: "msg_before",
    turnBoundaryMessageId: "msg_before",
    recoveredMessageIds: [],
    malformedAttempts: 0,
    continuationAttempts: 0,
    maxContinuations: 6,
    completionMarker: "ACCEPTANCE_DONE",
    checkpointPath: ".pi/TASK.md",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("durable managed agent runs", () => {
  beforeEach(() => resetManagedRunsForTest());

  it("survives a fresh module read without storing prompts or tool output", () => {
    putManagedRun(run());
    const restored = getManagedRun("local:test", "ses_long");
    expect(restored).toMatchObject({
      directory: "/tmp/project",
      completionMarker: "ACCEPTANCE_DONE",
      checkpointPath: ".pi/TASK.md",
      maxContinuations: 6,
    });
    expect(JSON.stringify(restored)).not.toContain("prompt");
    expect(JSON.stringify(restored)).not.toContain("output");
  });

  it("is scoped by server and removable after completion or explicit stop", () => {
    putManagedRun(run());
    expect(getManagedRun("ssh:other", "ses_long")).toBeNull();
    removeManagedRun("local:test", "ses_long");
    expect(getManagedRun("local:test", "ses_long")).toBeNull();
  });

  it("lists only contracts belonging to the selected server", () => {
    putManagedRun(run());
    putManagedRun(run({ serverKey: "ssh:other", sessionId: "ses_remote" }));
    expect(listManagedRuns("local:test").map((item) => item.sessionId)).toEqual(["ses_long"]);
  });

  it("bounds recovered message ids and exposes only operational summary", () => {
    const restored = putManagedRun(
      run({ recoveredMessageIds: Array.from({ length: 50 }, (_, index) => `msg_${index}`) }),
    );
    expect(restored.recoveredMessageIds).toHaveLength(32);
    expect(restored.recoveredMessageIds[0]).toBe("msg_18");
    expect(managedRunSummary(restored)).toEqual(
      expect.objectContaining({
        completionMarker: "ACCEPTANCE_DONE",
        continuationAttempts: 0,
      }),
    );
  });

  it("drops records older than thirty days", () => {
    vi.useFakeTimers();
    const now = new Date("2026-09-27T00:00:00Z");
    vi.setSystemTime(now);
    putManagedRun(run({ createdAt: now.getTime(), updatedAt: now.getTime() }));
    vi.setSystemTime(new Date("2026-10-28T00:00:01Z"));
    expect(getManagedRun("local:test", "ses_long")).toBeNull();
    vi.useRealTimers();
  });

  it("rejects persisted counters and paths outside the public contract", () => {
    putManagedRun(run({ maxContinuations: 21 }));
    expect(getManagedRun("local:test", "ses_long")).toBeNull();
    putManagedRun(run({ checkpointPath: "../escape", sessionId: "ses_escape" }));
    expect(getManagedRun("local:test", "ses_escape")).toBeNull();
  });
});
