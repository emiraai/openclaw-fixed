import { execSync } from "node:child_process";
import type { ApplyAuthChoiceParams, ApplyAuthChoiceResult } from "./auth-choice.apply.js";

const DEFAULT_AGENT_SDK_MODEL = "claude-cli/opus-4.6";

function resolveClaudeBinary(): string | null {
  const command = process.platform === "win32" ? "where claude" : "which claude";
  try {
    return (
      execSync(command, { encoding: "utf8", timeout: 5000 }).trim().split("\n")[0]?.trim() ?? null
    );
  } catch {
    return null;
  }
}

export async function applyAuthChoiceClaudeAgentSdk(
  params: ApplyAuthChoiceParams,
): Promise<ApplyAuthChoiceResult | null> {
  if (params.authChoice !== "claude-agent-sdk") {
    return null;
  }

  let nextConfig = params.config;

  // Verify claude binary exists
  const claudePath = resolveClaudeBinary();
  if (!claudePath) {
    await params.prompter.note(
      [
        "Claude Code CLI not found on PATH.",
        "Install it first: https://docs.anthropic.com/en/docs/claude-code/overview",
        "Then authenticate: claude login",
      ].join("\n"),
      "Claude CLI",
    );
    return { config: nextConfig };
  }

  await params.prompter.note(
    [
      `Found claude at: ${claudePath}`,
      "",
      "OpenClaw will spawn the claude CLI for each request.",
      "The CLI manages its own authentication — no API key needed.",
      "",
      "NOTE: This option is for personal, local development use.",
      "It uses your existing Claude Code session and subscription.",
      "For shared or hosted deployments, use an Anthropic API key instead.",
      "",
      "Policy: https://code.claude.com/docs/en/legal-and-compliance",
    ].join("\n"),
    "Claude CLI",
  );

  // Store the claude binary path in CLI backend config
  nextConfig = {
    ...nextConfig,
    agents: {
      ...nextConfig.agents,
      defaults: {
        ...nextConfig.agents?.defaults,
        cliBackends: {
          ...nextConfig.agents?.defaults?.cliBackends,
          "claude-agent-sdk": {
            command: claudePath,
          },
        },
      },
    },
  };

  if (params.setDefaultModel) {
    const { applyAgentDefaultModelPrimary } = await import("./onboard-auth.config-shared.js");
    nextConfig = applyAgentDefaultModelPrimary(nextConfig, DEFAULT_AGENT_SDK_MODEL);
  }

  return { config: nextConfig };
}
