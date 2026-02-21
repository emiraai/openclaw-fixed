# @openclaw/agent-resilience

Agent stability extension for openclaw – timeout retry with exponential back-off
and automatic image block stripping.

## Features

| Feature | Description |
|---------|-------------|
| **Retry back-off** | Exponential delay on retryable failures (`rate_limit`, `timeout`, `unknown`). Configurable base/max delay and max rounds. |
| **Image strip** | Replaces image content blocks with `[image omitted]` placeholder when the model returns an empty response, both in-memory and on disk. |

## Configuration

```jsonc
// openclaw.plugin.json configSchema fields
{
  "retryMaxRounds": 5,         // Max retry attempts
  "retryBaseDelayMs": 5000,    // Initial retry delay (ms)
  "retryMaxDelayMs": 120000,   // Maximum retry delay cap (ms)
  "imageStripEnabled": true,   // Enable auto image stripping
  "imageStripPersist": true    // Also strip images from session files on disk
}
```

## Exported API

### retry-backoff

| Export | Description |
|--------|-------------|
| `RETRYABLE_REASONS` | `readonly string[]` of reasons considered retryable |
| `RetryConfig` | Type: `{ baseDelayMs, maxDelayMs, maxRounds }` |
| `DEFAULT_RETRY_CONFIG` | Sensible defaults |
| `computeRetryDelay(attempt, config)` | Returns delay in ms (exponential, capped) |
| `isRetryableRound(reason, round, config)` | Whether to retry for the given reason/round |
| `sleep(ms)` | Promise-based delay helper |

### image-strip

| Export | Description |
|--------|-------------|
| `ImageStripResult` | Type: `{ messages, hadImages }` |
| `stripImageBlocksFromMessages(msgs)` | In-memory image block replacement |
| `stripImageBlocksFromSessionFile(path)` | On-disk JSONL session file image stripping |
| `isEmptyAssistantContent(msg)` | Check whether an assistant message has no meaningful content |

## Development

```bash
cd extensions/agent-resilience
npm install
npm test
```
