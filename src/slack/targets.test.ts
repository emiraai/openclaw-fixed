import { describe, expect, it } from "vitest";
import {
  looksLikeSlackTargetId,
  normalizeSlackMessagingTarget,
} from "../channels/plugins/normalize/slack.js";
import { parseSlackTarget, resolveSlackChannelId } from "./targets.js";

describe("parseSlackTarget", () => {
  it("parses user mentions and prefixes", () => {
    expect(parseSlackTarget("<@U123>")).toMatchObject({
      kind: "user",
      id: "U123",
      normalized: "user:u123",
    });
    expect(parseSlackTarget("user:U456")).toMatchObject({
      kind: "user",
      id: "U456",
      normalized: "user:u456",
    });
    expect(parseSlackTarget("slack:U789")).toMatchObject({
      kind: "user",
      id: "U789",
      normalized: "user:u789",
    });
  });

  it("parses channel targets", () => {
    expect(parseSlackTarget("channel:C123")).toMatchObject({
      kind: "channel",
      id: "C123",
      normalized: "channel:c123",
    });
    expect(parseSlackTarget("#C999")).toMatchObject({
      kind: "channel",
      id: "C999",
      normalized: "channel:c999",
    });
  });

  it("infers bare Slack IDs by prefix", () => {
    expect(parseSlackTarget("U12345678")).toMatchObject({
      kind: "user",
      id: "U12345678",
      normalized: "user:u12345678",
    });
    expect(parseSlackTarget("W12345678")).toMatchObject({
      kind: "user",
      id: "W12345678",
      normalized: "user:w12345678",
    });
    expect(parseSlackTarget("C12345678")).toMatchObject({
      kind: "channel",
      id: "C12345678",
      normalized: "channel:c12345678",
    });
  });

  it("rejects invalid @ and # targets", () => {
    expect(() => parseSlackTarget("@bob-1")).toThrow(/Slack DMs require a user id/);
    expect(() => parseSlackTarget("#general-1")).toThrow(/Slack channels require a channel id/);
  });
});

describe("resolveSlackChannelId", () => {
  it("strips channel: prefix and accepts raw ids", () => {
    expect(resolveSlackChannelId("channel:C123")).toBe("C123");
    expect(resolveSlackChannelId("C123")).toBe("C123");
  });

  it("rejects user targets", () => {
    expect(() => resolveSlackChannelId("user:U123")).toThrow(/channel id is required/i);
    expect(() => resolveSlackChannelId("U12345678")).toThrow(/channel id is required/i);
  });
});

describe("normalizeSlackMessagingTarget", () => {
  it("normalizes raw ids by inferred target kind", () => {
    expect(normalizeSlackMessagingTarget("C123")).toBe("channel:c123");
    expect(normalizeSlackMessagingTarget("U12345678")).toBe("user:u12345678");
  });
});

describe("looksLikeSlackTargetId", () => {
  it("recognizes bare Slack IDs including Z-prefixed channel IDs", () => {
    expect(looksLikeSlackTargetId("U12345678")).toBe(true);
    expect(looksLikeSlackTargetId("W12345678")).toBe(true);
    expect(looksLikeSlackTargetId("C12345678")).toBe(true);
    expect(looksLikeSlackTargetId("G12345678")).toBe(true);
    expect(looksLikeSlackTargetId("D12345678")).toBe(true);
    expect(looksLikeSlackTargetId("Z12345678")).toBe(true);
  });
});
