export type PostHogPluginConfig = {
  apiKey: string;
  host: string;
  privacyMode: boolean;
  enabled: boolean;
};

export type RunState = {
  traceId: string;
  spanId: string;
  startTime: number;
  model: string;
  provider: string;
  input: unknown[] | null;
  sessionKey?: string;
  channel?: string;
  agentId?: string;
};
