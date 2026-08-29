# Performance Report (FE-32)

## Overview

Audit of the frontend bundle with a focus on reducing the initial JS payload and
keeping the main thread responsive when rendering heavy components.

## Findings

1. **`lightweight-charts` (PriceChart)** — a large client-only charting library
   (~100KB gzipped) is pulled into the `calls/[id]` page for every visitor, even
   before the chart is visible. It must be isolated into its own chunk.
2. **`StakingModal` / `WalletConnectButton`** — loaded eagerly though only needed
   on user interaction.
3. **No performance instrumentation** — nothing records time-to-interactive or
   long tasks, so regressions can't be detected.

## Changes

- `app/calls/[id]/page.tsx`: `PriceChart` is now loaded with `next/dynamic`
  (`ssr: false`) + a skeleton fallback, so the chart library is a separate chunk
  fetched only when needed.
- `components/Feed.tsx`: `StakingModal` is loaded dynamically on open with a
  skeleton fallback.
- `app/page.tsx`: `WalletConnectButton` is loaded dynamically.
- `src/lib/perf.ts`: `markStart`/`markEnd` timing helpers, `deferIdleTask`, and a
  shared `dynamicSkeleton` fallback component.

## Impact

- Splitting `PriceChart` (and `lightweight-charts`) cuts it out of the critical
  initial route chunk.
- Code-splitting the modal + wallet reduce parse/execution cost on first paint.
- Enhanced first paint at the cost of a small loading skeleton before charts or
  modals appear (network-dependent).

## Recommended follow-ups

- Send `perf-timing` events to a real analytics endpoint.
- Measure Lighthouse before/after with a representative route.
- Add a `<noscript>` minimal chart fallback for the `calls/[id]` route.
