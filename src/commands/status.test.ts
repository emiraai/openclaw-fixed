import { describe, it, expect } from "vitest";
import { classifySessionType, groupSessions } from "./status.summary.js";
import type { SessionStatus } from "./status.types.js";

// Helper to create mock sessions for testing
const createMockSession = (
  key: string,
  sessionType: "main" | "cronJob" | "cronRun" | "other",
): SessionStatus => ({
  key,
  sessionType,
  kind: "direct",
  updatedAt: Date.now(),
  age: 0,
  totalTokens: 0,
  totalTokensFresh: false,
  remainingTokens: null,
  percentUsed: null,
  model: null,
  contextTokens: null,
  flags: [],
});

describe("Session Type Classification", () => {
  describe("main sessions", () => {
    it("classifies agent:main:main as main", () => {
      expect(classifySessionType("agent:main:main", "direct")).toBe("main");
    });

    it("classifies simple direct sessions as main", () => {
      expect(classifySessionType("agent:main:direct", "direct")).toBe("main");
      expect(classifySessionType("agent:worker:session123", "direct")).toBe("main");
      expect(classifySessionType("agent:custom:simple", "direct")).toBe("main");
    });

    it("classifies per-peer direct sessions as main", () => {
      // DM sessions with peer IDs should still be main (interactive)
      expect(classifySessionType("agent:main:direct:peer123", "direct")).toBe("main");
      expect(classifySessionType("agent:main:direct:user456", "direct")).toBe("main");
    });

    it("classifies channel-specific direct sessions as main", () => {
      // line:direct:peerId pattern
      expect(classifySessionType("agent:main:line:direct:peer123", "direct")).toBe("main");
    });
  });

  describe("cron job definitions", () => {
    it("classifies agent:main:cron:abc123 as cronJob", () => {
      expect(classifySessionType("agent:main:cron:abc123", "direct")).toBe("cronJob");
    });

    it("classifies cron with UUID as cronJob", () => {
      expect(
        classifySessionType("agent:main:cron:4dbb2a6a-c68c-4a8d-9a4a-796f8ec32945", "direct"),
      ).toBe("cronJob");
    });
  });

  describe("cron run history", () => {
    it("classifies agent:main:cron:abc123:run:def456 as cronRun", () => {
      expect(classifySessionType("agent:main:cron:abc123:run:def456", "direct")).toBe("cronRun");
    });

    it("uses canonical isCronRunSessionKey for detection", () => {
      expect(
        classifySessionType(
          "agent:main:cron:4dbb2a6a-c68c-4a8d-9a4a-796f8ec32945:run:c8d4f669-e70f-474a-b3ca-c418f600b899",
          "direct",
        ),
      ).toBe("cronRun");
    });
  });

  describe("other sessions", () => {
    it("classifies group sessions as other", () => {
      expect(classifySessionType("agent:main:group:discord", "group")).toBe("other");
      expect(classifySessionType("agent:main:group:telegram", "group")).toBe("other");
    });

    it("classifies channel sessions as other", () => {
      expect(classifySessionType("agent:main:channel:slack", "group")).toBe("other");
    });

    it("classifies subagent sessions as other", () => {
      expect(classifySessionType("agent:main:subagent:task1", "direct")).toBe("other");
    });

    it("classifies acp sessions as other", () => {
      expect(classifySessionType("agent:main:acp:session1", "direct")).toBe("other");
    });

    it("classifies non-agent keys as other", () => {
      expect(classifySessionType("global")).toBe("other");
      expect(classifySessionType("unknown")).toBe("other");
      expect(classifySessionType("")).toBe("other");
      expect(classifySessionType("invalid")).toBe("other");
    });
  });
});

describe("Session Grouping", () => {
  it("groups sessions by type correctly", () => {
    const sessions: SessionStatus[] = [
      createMockSession("agent:main:main", "main"),
      createMockSession("agent:main:direct:peer1", "main"),
      createMockSession("agent:main:cron:job1", "cronJob"),
      createMockSession("agent:main:cron:job1:run:1", "cronRun"),
      createMockSession("agent:main:group:discord", "other"),
    ];

    const grouped = groupSessions(sessions);

    expect(grouped.active.count).toBe(2);
    expect(grouped.active.sessions).toHaveLength(2);
    expect(grouped.cronJobs.count).toBe(1);
    expect(grouped.cronRuns.count).toBe(1);
    expect(grouped.other.count).toBe(1);
  });

  it("does not collapse cron runs when count <= 20", () => {
    const sessions = Array.from({ length: 20 }, (_, i) =>
      createMockSession(`agent:main:cron:job:run:${i}`, "cronRun"),
    );

    const grouped = groupSessions(sessions);

    expect(grouped.cronRuns.collapsed).toBe(false);
    expect(grouped.cronRuns.count).toBe(20);
    expect(grouped.cronRuns.sessions).toHaveLength(20);
  });

  it("collapses cron runs when count > 20", () => {
    const sessions = Array.from({ length: 50 }, (_, i) =>
      createMockSession(`agent:main:cron:job:run:${i}`, "cronRun"),
    );

    const grouped = groupSessions(sessions);

    expect(grouped.cronRuns.collapsed).toBe(true);
    expect(grouped.cronRuns.count).toBe(50);
    expect(grouped.cronRuns.sessions).toHaveLength(5); // Only first 5 shown
  });

  it("never collapses active or cronJobs groups", () => {
    const sessions = [
      ...Array.from({ length: 100 }, (_, i) => createMockSession(`agent:main:main${i}`, "main")),
      ...Array.from({ length: 50 }, (_, i) =>
        createMockSession(`agent:main:cron:job${i}`, "cronJob"),
      ),
    ];

    const grouped = groupSessions(sessions);

    expect(grouped.active.collapsed).toBe(false);
    expect(grouped.active.count).toBe(100);
    expect(grouped.active.sessions).toHaveLength(100);
    expect(grouped.cronJobs.collapsed).toBe(false);
    expect(grouped.cronJobs.count).toBe(50);
    expect(grouped.cronJobs.sessions).toHaveLength(50);
  });

  it("handles empty sessions", () => {
    const grouped = groupSessions([]);

    expect(grouped.active.count).toBe(0);
    expect(grouped.cronJobs.count).toBe(0);
    expect(grouped.cronRuns.count).toBe(0);
    expect(grouped.other.count).toBe(0);
  });

  it("preserves correct labels", () => {
    const grouped = groupSessions([]);

    expect(grouped.active.label).toBe("Active");
    expect(grouped.cronJobs.label).toBe("Cron Jobs");
    expect(grouped.cronRuns.label).toBe("Recent Runs");
    expect(grouped.other.label).toBe("Other");
  });
});
