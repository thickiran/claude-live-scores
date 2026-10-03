# Live Scores (plugin)

Live football scores, goal celebrations and a mascot kickabout inside Claude Code. Full description, screenshots and install steps: [the repository README](https://github.com/thickiran/claude-live-scores#readme).

This file states exactly what the mod reads, runs, contacts and sends.

## What each hook does

The mod hooks **no tool calls, prompts, model responses, files or turns**. It never sees your code or your conversation.

| Hook | What it reads | What it does with it |
| --- | --- | --- |
| `session.start` | Nothing | Registers `/scores`, loads the pitch on/off preference, starts its timers and fetches the scores. Opens the pane if a match is live. |
| `command.run` (`/scores`) | The arguments typed after `/scores` | Runs the subcommands: open, `live`, `all`, `refresh`, `pitch`, `demo`, `close`. |
| `ui.render` (its own pane) | Its own state | Draws the scores pane. |
| `ui.render` (`AbovePrompt`) | Its own state, and whether a survey is showing there | While a match is live, draws the mascot pitch above the prompt, with whatever Claude Code draws there passed through unchanged below it. When no match is live, or a survey is showing, it draws nothing. |

Timers: a check every 30 seconds that fetches when due (see below); a 150 ms tick while a celebration plays; a 125 ms frame tick for the terminal pitch, only while a terminal is drawing it; and a 20-second turn that rotates the pitch between live matches.

## Programs it runs

One program, `curl`, started by name with fixed options, never through a shell.

- **When:** once per team crest or flag, then never again (the image is cached).
- **What:** it downloads a 40 px PNG from ESPN's image server, with the options *silent*, *fail on HTTP errors*, *follow redirects* and an *8-second limit*, the user agent below, and *write to* `live-scores-crest.png` in the system temp folder. Only crest paths under `https://a.espncdn.com/i/teamlogos/` are accepted, and one download runs at a time.
- **Why:** Claude Code's own fetch returns text only, so `curl` carries the image's bytes into that scratch file, which the mod reads back with Claude Code's file API.

The scoreboards themselves are fetched with Claude Code's own fetch, not `curl`.

## Hosts it contacts

- `site.api.espn.com`: `GET` requests for the public scoreboards of 17 competitions, for today and yesterday, plus each competition's next matchday every 10 minutes. It fetches every 30 seconds while a match is live or kicks off within 15 minutes, otherwise every 10 minutes.
- `a.espncdn.com`: `GET` requests for team crests and flags, once per team, through `curl` (above).

Every request names the mod with `User-Agent: live-scores/0.1 (+https://github.com/thickiran/claude-live-scores)`; the scoreboard requests also ask for `Accept: application/json`. ESPN's server answers Claude Code's default user agent with 403, so the mod names itself.

## What it sends, and where

Nothing about you. The requests above contain only the competition and the date in their URLs: **no cookies, credentials, account details, file paths, code, prompts or conversation text**.

## What it stores locally

- Crest and flag images (base64 PNGs), in Claude Code's per-plugin store, one entry per image URL.
- Whether the pitch is on or off.
- One scratch file, `live-scores-crest.png` in the system temp folder, overwritten by each crest download.

Scores, celebrations and everything else live in the session's memory only.
