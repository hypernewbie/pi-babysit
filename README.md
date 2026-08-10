# pi-babysit

pi-babysit watches your Pi session in the background. A second model checks whether the work still matches your original intent and your project rules. It only reports drift. It never edits files, runs tools, or steers the agent.

## How it works

Each check sends two parts to the babysitter model. The first part never changes between checks. It contains the role, the rubric, your original request, the files you referenced, and the JSON format the model must use. Because this part is stable, Pi can reuse the prompt cache.

The second part changes each time. It contains recent messages, tool names, truncated results, errors, and the count of tools since the last check.

Pi counts completed tools. When the count reaches the threshold, Pi runs the next check at the end of the turn. Pi waits for the check to complete before it starts the next turn. Only one check runs per turn, even when tools run in parallel. The remainder carries to the next cycle.

You can also run a check by hand at any time.

## Install

Install it as a Pi package:

```bash
pi install git:github.com/hypernewbie/pi-babysit
```

`pi install` clones the repo, installs it, and adds it to `settings.json`.
Pi loads it on the next session.

For the current project only, add `-l`:

```bash
pi install -l git:github.com/hypernewbie/pi-babysit
```

Try it once without installing:

```bash
pi -e git:github.com/hypernewbie/pi-babysit
```

For local development, install the directory directly:

```bash
pi install /path/to/pi-babysit
```

The extension has no runtime npm dependencies, so no separate `npm install`
is needed.

## Use it

```text
/babysit
/babysit @file/RULEZ.md
/babysit @file/RULEZ.md @file/NOTES.md
/babysit --every 5 --model anthropic/claude-3-5-haiku-latest
```

Options:

- `--every N`: check after N completed tools. Default is 5.
- `--model provider/model-id`: babysitter model for this session.
- `@file/path`: add a file to the stable prefix.

Paths after `@file/` are relative to the session directory. Absolute paths also work. Pi removes duplicates, enforces size limits, and reloads a file only when the file changes.

## Privacy and cost

Only two things leave your machine: the files you reference with `@file/` and the recent activity tail. Pi does not send the full system prompt. Each check is a separate model call with its own cost. The prompt cache keeps cost low when the stable prefix does not change.

## Develop

To work on the extension, do these steps:

1. Run `npm install` in the extension directory.
2. Run `npm run typecheck` to check types.
3. Run `npm test` to run tests.
4. Run `npm pack --dry-run` to inspect the package.

## Notes

`turn_end` handlers run before Pi starts the next turn. At that point, tool results are already in the session tree. For periodic checks, use `turn_end` as the main hook.

The extension is advisory only. It does not stop the agent.
