# pi-babysit

pi-babysit watches your Pi session in the background. A second model checks whether the work still matches your original intent and your project rules. It only reports drift. It never edits files, runs tools, or steers the agent.

## How it works

Each check sends two parts to the babysitter model. The first part never changes between checks. It contains the role, the rubric, your original request, the files you referenced, and the JSON format the model must use. Because this part is stable, Pi can reuse the prompt cache.

The second part changes each time. It contains recent messages, tool names, truncated results, errors, and the count of tools since the last check.

Pi counts completed tools. When the count reaches the threshold, Pi runs the next check at the end of the turn. Pi waits for the check to complete before it starts the next turn. Only one check runs per turn, even when tools run in parallel. The remainder carries to the next cycle.

You can also run a check by hand at any time.

## Install

You can install from GitHub before copying to your extension folder:

```bash
# Clone the repo

git clone https://github.com/hypernewbie/pi-babysit.git
cd pi-babysit
```

To install for one project:

1. Copy the `pi-babysit` directory to `.pi/extensions/pi-babysit`.
2. Run `npm install --omit=dev` in that directory.
3. Run `/reload` in Pi.

For a global install:

1. Copy the directory to `~/.pi/agent/extensions/pi-babysit`.
2. Run `npm install --omit=dev` in that directory.
3. Run `/reload` in Pi.

## Use it

```text
/babysit
/babysit now @file/RULEZ.md
/babysit now @file/RULEZ.md @file/NOTES.md
/babysit on --every 5 --model anthropic/claude-3-5-haiku-latest
/babysit off
/babysit status
```

Options:

- `--every N`: check after N completed tools. Default is 5.
- `--model provider/model-id`: babysitter model for this session.
- `--tail-tokens N`: token budget for recent activity. Default is 6000.
- `@file/path`: add a file to the stable prefix.

Paths after `@file/` are relative to the session directory. Absolute paths also work. Pi removes duplicates, enforces size limits, and reloads a file only when the file changes.

## Configuration

You can set defaults in `.pi/babysit.json`. All fields are optional.

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

`cacheRetention` controls prompt cache use. Use `short` for frequent checks. Use `long` when checks are far apart. Use `none` to disable cache use. Long writes cost more.

`persistVerdicts` saves each result as a custom session entry. `runAfterSettle` also runs a pending check after the full agent run completes.

## Verdicts

The babysitter returns strict JSON:

```json
{
  "status": "on_track",
  "confidence": 0.87,
  "summary": "The work remains focused on the requested migration.",
  "evidence": ["Recent tool calls modify the requested package."],
  "recommendation": "Continue."
}
```

`status` is one of `on_track`, `concern`, `off_track`, or `unclear`. A broken response becomes `unclear`. It never becomes `off_track` by default. A failed request is an error, not a verdict.

## Privacy and cost

Only two things leave your machine: the files you reference with `@file/` and the recent activity tail. Pi does not send the full system prompt. Each check is a separate model call with its own cost. The prompt cache keeps cost low when the stable prefix does not change. Use `/babysit status` to see total input, output, cache use, and cost for babysitter calls. This total is separate from Pi's main session total.

## Develop

To work on the extension, do these steps:

1. Run `npm install` in the extension directory.
2. Run `npm run typecheck` to check types.
3. Run `npm test` to run tests.
4. Run `npm pack --dry-run` to inspect the package.

## Notes

`turn_end` handlers run before Pi starts the next turn. At that point, tool results are already in the session tree. For periodic checks, use `turn_end` as the main hook. `agent_settled` fires later, after retries and continuations settle.

The extension is advisory only. A `concern` or `off_track` result shows a notice. It does not stop the agent.

See `PI_BABYSIT_PLAN.md` for the full plan.
