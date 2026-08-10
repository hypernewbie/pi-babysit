# pi-babysit

pi-babysit watches your Pi session in the background. A second (cheaper) model enforces the session rules you set — an inline rule like `do not talk about the roman empire`, or project rules from `@file/` references. It reports drift in the footer, and when enabled (`--steer`) it injects a reminder into the session that the agent must answer. It never edits files or runs tools.

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
/babysit on --every 5 --model opencode-go/deepseek-v4-flash --steer do not talk about the roman empire
```

Options:

- `--every N`: check after N completed tools. Default is 5.
- `--model provider/model-id`: babysitter model for this session.
- `--steer[=level]`: on a rule violation, inject a reminder into the session that the agent must answer. Levels: `off_track` (default), `concern`, `off`. `concern` sends a short nudge; `off_track` sends the full reminder with evidence.
- `@file/path`: add a file to the stable prefix.
- Any other text: a rule the session must follow, enforced by the check (also `--instruction ...`).

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

The extension is advisory by default: it reports verdicts and never edits files or runs tools. With `--steer`, an `off_track` or `concern` verdict also injects a reminder message that the agent must answer.
