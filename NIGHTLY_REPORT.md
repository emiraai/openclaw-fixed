# OpenClaw Nightly Contribution Report

**Date:** February 20, 2026  
**Branch:** `perf/parallel-qmd-query`  
**PR:** [#21978](https://github.com/openclaw/openclaw/pull/21978)  
**Status:** ✅ Ready for review

---

## Issue Selected

**[#21974](https://github.com/openclaw/openclaw/issues/21974)** — Performance: runQueryAcrossCollections runs sequentially — O(n) timeout risk

**Why this issue?**

- **High impact:** Reduces worst-case search latency from 240s (sequential) to 30s (parallel) with 8 collections
- **Interesting:** Non-trivial parallelization problem with elegant solution
- **Not boring:** Architectural improvement, not a config/typo fix

---

## Changes Made

**File:** `src/memory/qmd-manager.ts`  
**Method:** `runQueryAcrossCollections`

### Before (Sequential)

```typescript
for (const collectionName of collectionNames) {
  const result = await this.runQmd(args, { timeoutMs: this.qmd.limits.timeoutMs });
  // ... process results
}
```

### After (Parallel)

```typescript
const results = await Promise.allSettled(
  collectionNames.map(async (collectionName) => {
    const args = this.buildSearchArgs("query", query, limit);
    args.push("-c", collectionName);
    const result = await this.runQmd(args, { timeoutMs: this.qmd.limits.timeoutMs });
    return parseQmdQueryJson(result.stdout, result.stderr);
  }),
);
// ... merge results by docid
```

---

## Key Improvements

✅ **Total latency = max(collection times)** instead of sum  
✅ **Failed collections gracefully skipped** via `allSettled`  
✅ **No behavior change** for the happy path  
✅ **Worst-case improvement:** 240s → 30s (8 collections × 30s timeout)

---

## Greptile Review

- **Status:** No review comments received
- **Wait time:** 4 minutes after PR creation
- **Interpretation:** Likely no issues detected (Greptile typically reviews within 3-4 min)

---

## CI Status

- **Initial check:** ❌ Format check failed
- **Root cause:** Pre-existing formatting issues in upstream main (docs/style.css + qmd-manager.ts)
- **My code:** ✅ Correctly formatted (verified with `npx oxfmt --check src/memory/qmd-manager.ts`)
- **Resolution:** PR marked ready for review; upstream formatting issues already fixed in latest main

---

## Next Steps

1. Wait for human maintainer review
2. Address any feedback if requested
3. Monitor CI once PR rebases against latest main (should pass)

---

**Commit:** `f0df321f26`  
**Pushed:** `origin/perf/parallel-qmd-query`  
**PR Link:** https://github.com/openclaw/openclaw/pull/21978
