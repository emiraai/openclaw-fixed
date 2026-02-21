---
name: model-optimizer
description: >
  Benchmark, score, and auto-rotate LLM models for optimal performance.
  Use when asked to: optimize models, benchmark models, check model health,
  run model tests, find the best model, compare model performance,
  check which models are working, rotate models, update model config,
  schedule periodic model benchmarks, discover free providers, or
  troubleshoot slow/broken model responses.
---

# Model Auto-Optimizer

Benchmark all configured (and optionally discovered) AI models with a 3-test suite, score them on a composite metric, and auto-configure OpenClaw to use the best model.

## Quick Start

Run a full benchmark with auto-rotation:

```bash
node {baseDir}/scripts/run.cjs --auto
```

Dry run (score and rank without changing config):

```bash
node {baseDir}/scripts/run.cjs --dry-run --verbose
```

JSON output for scripting:

```bash
node {baseDir}/scripts/run.cjs --json
```

## Test Suite

Each model is tested with 3 prompts (run in parallel):

| Test | Prompt | Validates |
|------|--------|-----------|
| Math | "What is 2+2? Reply with only the number." | Correctness (response contains "4") |
| Instruction | "List exactly 3 colors, one per line." | Instruction following (3 color lines) |
| Availability | "Say hello." | Basic availability (non-empty response) |

## Scoring Criteria

Composite score (0-100) with linear interpolation within bands:

| Criterion | Weight | Excellent | Good | Fair | Poor |
|-----------|--------|-----------|------|------|------|
| Latency (TTFT) | 40% | <500ms (100) | <2s (75) | <5s (50) | <10s (25) |
| Throughput | 25% | >100 tok/s (100) | >20 (75) | >10 (50) | >5 (25) |
| Correctness | 20% | 3/3 pass (100) | 2/3 (66) | 1/3 (33) | 0/3 (0) |
| Availability | 15% | 3/3 succeed (100) | 2/3 (66) | 1/3 (33) | 0/3 (0) |

## CLI Options

| Flag | Description | Default |
|------|-------------|---------|
| `--auto` | Benchmark and auto-rotate if improvement found | off |
| `--dry-run` | Score without config changes | off |
| `--discover` | Test registry providers with env keys | off |
| `--json` | JSON-only output | off |
| `--verbose` | Show per-test score breakdown | off |
| `--timeout N` | Per-request timeout (ms) | 30000 |
| `--concurrency N` | Max parallel model tests | 10 |
| `--threshold N` | Min % improvement to rotate | 10 |
| `--providers X` | Comma-separated provider filter | all |
| `--weights JSON` | Custom scoring weights | default |

## Auto-Rotation Safety

- Only rotates if new best scores **>10%** better than current primary
- If current primary fails all tests, rotates immediately
- Prefers free models over paid when scores are adequate
- Always keeps **3-6 fallbacks** ordered by composite score
- Creates **timestamped backup** before any config change
- Uses **atomic write** (write .tmp then rename) to prevent corruption
- Sends **SIGUSR1** for gateway hot-reload
- Never removes a working model -- only reorders

## Provider Discovery

Pass `--discover` to test free models from known providers. Set the env var to enable:

| Provider | Env Var | Signup |
|----------|---------|--------|
| NVIDIA NIM | `NVIDIA_API_KEY` | build.nvidia.com |
| Groq | `GROQ_API_KEY` | console.groq.com |
| Cerebras | `CEREBRAS_API_KEY` | cloud.cerebras.ai |
| SambaNova | `SAMBANOVA_API_KEY` | cloud.sambanova.ai |
| Together.ai | `TOGETHER_API_KEY` | api.together.xyz |
| HuggingFace | `HF_TOKEN` | huggingface.co |
| GitHub Models | `GITHUB_TOKEN` | github.com/marketplace/models |

Discovered providers are automatically added to OpenClaw config.

For provider API details, rate limits, and model lists, see `references/providers.md`.

## Cron Scheduling

Daily benchmark at 6 AM UTC:

```bash
openclaw cron add --name "model-optimizer:benchmark" \
  --schedule "0 6 * * *" \
  --command "node /host/home/openclaw/skills/model-optimizer/scripts/run.cjs --auto"
```

Weekly full benchmark with discovery (Sunday midnight):

```bash
openclaw cron add --name "model-optimizer:full-benchmark" \
  --schedule "0 0 * * 0" \
  --command "node /host/home/openclaw/skills/model-optimizer/scripts/run.cjs --auto --discover"
```

Check or update cron:

```bash
openclaw cron list
```

## Results

- `/tmp/model-optimizer-latest.json` - Most recent run (overwritten)
- `/tmp/model-optimizer-history.jsonl` - Append-only history (one JSON line per run)

Each result includes: timestamp, per-model scores, rankings, rotation decision with reason, backup path.

## Troubleshooting

- **All models fail**: Check network, API keys, provider status pages
- **No rotation despite better model**: Threshold not met (use `--threshold 0` to force)
- **Gateway doesn't reload**: Run `kill -USR1 1` manually
- **Slow benchmarks**: Reduce `--timeout` or filter with `--providers nvidia`
- **Rate limited**: Lower `--concurrency` or wait between runs
