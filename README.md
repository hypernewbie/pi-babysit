# pi-babysit

A read-only drift health check for [Pi](https://github.com/earendil-works/pi)
coding sessions. A separately configured (usually cheaper) model periodically
judges whether the active session is still aligned with the user's original
intent and with explicit project rules. It **reports** drift — it never edits
files, invokes tools, steers the main agent, or injects messages.

## How it works

Every check sends two parts to the babysitter model:

1. **Stable prefix** (byte-identical between checks): the babysitter role and
   rubric, the original user intent (captured once per session), the contents
   of referenced `@file/...` files, and the strict JSON response contract.
   Because it is stable, provider prompt caches can hit on it.
2. **Dynamic suffix**: a bounded, chronological tail of recent session
   activity (user/assistant messages, tool names, truncated results, errors),
   plus the number of tools since the last check and the previous verdict.

Checks run:

- manually with `/babysit now` (after `ctx.waitForIdle()`), or
- automatically: completed tool executions are counted (`tool_execution_end`),
  and when the threshold is crossed the check runs **awaited at `turn_end`**,
  after Pi has persisted the current tool results and before it prepares the
  next model turn. Only one check runs per turn, even for parallel batches;
  the remainder (`count % every`) carries to the next crossing.

## Install

Drop the package into an extension location and install its dev-free runtime
(no runtime deps beyond Pi itself):

```bash
# project-local (loads after the project is trusted)
mkdir -p .pi/extensions && cp -r pi-babysit .pi/extensions/pi-babysit
cd .pi/extensions/pi-babysit && npm install --omit=dev

# or global
cp -r pi-babysit ~/.pi/agent/extensions/pi-babysit
cd ~/.pi/agent/extensions/pi-babysit && npm install --omit=dev
```

Reload with `/reload`.

## Usage

```text
/babysit                                immediate check
/babysit now @file/RULEZ.md             immediate check with a rule file
/babysit now @file/RULEZ.md @file/PROJECT_NOTES.md
/babysit now --tail-tokens 6000
/babysit on --every 5 --model anthropic/claude-3-5-haiku-latest
/babysit off
/babysit status
```

Flags:

| Flag | Meaning |
| --- | --- |
| `--every N` | auto-check after N completed tool executions (default 5) |
| `--model provider/model-id` | babysitter model (overrides config) |
| `--tail-tokens N` | dynamic suffix budget in estimated tokens (default 6000) |
| `@file/path` | include a file's contents in the stable prefix |

`@file` paths are relative to the session's working directory; absolute paths
work too (`@file//tmp/notes.md`). Files are deduplicated, size-limited
(default 64 KiB each, 128 KiB total), and re-read only when they change.

### Project config

`.pi/babysit.json` (all optional):

```json
{
  "model": "anthropic/claude-3-5-haiku-latest",
  "enabled": false,
  "everyToolCalls": 5,
  "tailTokens": 6000,
  "rules": ["RULEZ.md"],
  "cacheRetention": "short",
  "maxFileBytes": 65536,
  "maxTotalRefBytes": 131072,
  "maxToolResultChars": 4000,
  "maxToolResults": 3,
  "persistVerdicts": false,
  "runAfterSettle": false
}
```

- `cacheRetention`: `"short"` (default) for checks every few tools; `"long"`
  for intervals that outlive the short cache TTL — long writes cost more.
  `"none"` disables provider prompt caching.
- `persistVerdicts`: append each verdict as a non-LLM custom session entry
  (`customType: "babysit-check"`) for history/status views.
- `runAfterSettle`: also run a pending check at `agent_settled` (after the
  whole agent run settles) — lower latency-insensitive mode.

## Model

Any Pi-configured model works; the babysitter request has no tools, caps
output at 300 tokens, uses `temperature: 0`, and never changes the session's
main model. `modelRegistry.hasConfiguredAuth()` is checked as a preflight.

## Verdicts

The model must return strict JSON:

```json
{
  "status": "on_track",
  "confidence": 0.87,
  "summary": "The work remains focused on the requested migration.",
  "evidence": ["Recent tool calls modify the requested package."],
  "recommendation": "Continue."
}
```

`status` is one of `on_track | concern | off_track | unclear`. Malformed
responses become `unclear` — never `off_track`. Request failures
(`stopReason: "error" | "aborted"`) are reported as errors and are never
parsed as verdicts.

## Privacy & cost

- Referenced `@file/...` contents and the recent-activity tail are sent to
  the configured babysitter provider. The prefix is *not* the full system
  prompt — it is the babysitter's own instructions plus whatever you
  explicitly reference.
- Each check is a separate model call with its own cost. `cacheRetention:
  "short"` keeps per-check cost low when the prefix is stable.
- Babysitter usage is tracked independently and shown in `/babysit status`
  (it is not a Pi tool result, so it does not appear in Pi's normal session
  usage totals).

## Development

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # node --test (native TS, no test framework)
npm pack --dry-run
```

## Design notes

- `turn_end` handlers are awaited by Pi before it prepares the next model
  turn, and tool-result messages are already persisted to the session tree by
  then — so the automatic check is a true gate over a coherent snapshot.
  `agent_settled` is intentionally *not* the primary hook: it fires only after
  the entire run (retries, compaction retries, queued continuations) settles,
  which is too late for periodic checks.
- The extension-facing `ReadonlySessionManager` has no `buildSessionContext()`;
  the dynamic tail is built from `buildContextEntries()` instead.
- Advisory mode is the default: a `concern`/`off_track` notification does not
  pause the agent. A future opt-in guard mode could `ctx.abort()` the active
  run on `off_track`; that is a deliberate, separate feature.

See `PI_BABYSIT_PLAN.md` for the full design and open product decisions.
