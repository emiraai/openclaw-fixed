# Trusted Groups Feature Specification (Option 1 - Telegram Extension)

## Goal
Allow specific Telegram group chats to be treated as "main" sessions via the existing `channels.telegram.groups` config.

## Proposed Solution

### 1. Config Schema Extension

Extend the existing per-group config in `channels.telegram.groups.<groupId>` to add a `trusted` field:

```typescript
// In Telegram channel types
type TelegramGroupConfig = {
  // ... existing fields
  groupPolicy?: "open" | "allowlist" | "disabled";
  requireMention?: boolean;
  skills?: string[];
  allowFrom?: Array<string | number>;
  systemPrompt?: string;
  enabled?: boolean;
  topics?: Record<string, TelegramTopicConfig>;
  
  // NEW: Treat this group as a trusted main session
  trusted?: boolean;
};
```

When `trusted: true`:
- Group session uses main session key: `agent:main:main` instead of `agent:main:telegram:group:<id>`
- MEMORY.md is loaded for the session
- Context is shared with direct messages

### 2. Files to Modify

1. **src/channels/telegram/types.ts** - Add `trusted?: boolean` to group config type
2. **src/config/zod-schema.channels.ts** - Add `trusted: z.boolean().optional()` to Telegram group schema
3. **src/routing/session-key.ts** - Modify session key generation to check for trusted groups
4. **src/routing/resolve-route.ts** - Pass Telegram group config to session key builder
5. **src/config/schema.labels.ts** - Add label for `channels.telegram.groups.*.trusted`
6. **src/config/schema.help.ts** - Add help text
7. **src/routing/session-key.test.ts** - Add unit tests

### 3. Implementation Details

The session key builder needs access to the channel-specific group config to check if a group is trusted.

Option A: Pass full config to session-key.ts
Option B: Pass a `isTrustedGroup` function/flag

Prefer Option A - pass the group config lookup to session key builder.

### 4. Usage Example

```yaml
channels:
  telegram:
    enabled: true
    botToken: "123:abc"
    groups:
      "-1001234567890":  # Crab People group
        trusted: true
        requireMention: false
```

### 5. Testing
- Unit tests for session key generation with trusted groups
- Integration test verifying MEMORY.md loads for trusted groups
- Test that non-trusted groups still use isolated sessions

## Backward Compatibility
- Feature is opt-in via `trusted: true` 
- Default behavior unchanged (groups isolated)
- No breaking changes
