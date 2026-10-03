# AGENTS.md

Guide for AI agents (Claude Code, Codex, Cursor, …) working with this repo. Humans: see [README.md](README.md).

## What this is

A Claude Code **mod** (a plugin of function hooks): live football scores in a pane, goal / red-card / VAR animations, and Claude mascots in the live match's kits playing a kickabout above the prompt. Scores come from ESPN's public scoreboard feed. No server, no dependencies, no build step, no API key.

## If a user asks you to install it

Run these in the user's terminal (or have them type the slash forms in Claude Code):

```bash
claude plugin marketplace add thickiran/claude-live-scores
claude plugin install live-scores@claude-live-scores
```

Slash forms: `/plugin marketplace add thickiran/claude-live-scores`, then `/plugin install live-scores@claude-live-scores`.

Then tell them:
- **Start a new Claude Code session.** `/scores` opens the pane; it also opens on its own when a match kicks off.
- **While a match is live,** the mascot pitch plays above the prompt. `/scores pitch` turns it off or on.
- **`/scores demo`** plays a scripted match (goal, red card, VAR, full time) to show everything off when nothing is live.
- **If `/scores` never appears,** their Claude Code build may not have plugin function hooks yet (early access).

To try a local checkout without installing: `claude --plugin-dir plugins/live-scores`.

## Repo map

```
.claude-plugin/marketplace.json     the marketplace listing (one plugin)
plugins/live-scores/                the mod itself
  .claude-plugin/plugin.json        manifest: name, version, types contract
  .claude-plugin/icon.png           listing icon
  hooks/hooks.json                  names the hooks module
  hooks/register.tsx                ALL hooks and every function that touches `$`
  hooks/espn.ts                     competitions, scoreboard URLs, the parser (pure)
  hooks/svg.ts                      desktop cards: league headers, match cards, celebration overlays (pure)
  hooks/pitch.ts                    the kickabout: choreography, desktop SVG, terminal block pixels (pure)
  types/index.d.ts                  $.state contract
  tests/pane.test.tsx               engine tests: pane and pitch on terminal and desktop
scripts/preview.mjs                 renders today's scores and the pitch to preview.html, offline-ish
docs/                               README images and the promo
```

## Check your work

```bash
npm test            # claude plugin validate (marketplace + plugin) and claude plugin test
npm run preview     # writes preview.html with today's real scores; OPEN it and look
```

`npm run preview` needs Node ≥ 22.18 (it runs the `.ts` files directly). `npm test` needs the `claude` CLI on PATH. For a visual change, open `preview.html` in a browser: it draws each SVG exactly as the desktop app does (an `<img>`, `display:block; max-width:100%`). A change isn't done until it looks right there.

## How it works

- **Polling** (`register.tsx`): a 30 s `$.clock.every` calls `refresh`, which fetches when due: every 30 s while a match is live or kicks off within 15 minutes, otherwise every 10 minutes. Each competition is fetched for today and yesterday (ESPN dates are US time), plus the undated next-matchday feed every 10 minutes. Fresh rows replace old ones by match id.
- **Moments**: `diff` compares each match with its previous fetch. A higher score is a goal, a lower one a VAR reversal, a new red card a red card. Each becomes a `Celebration` in `$.state` for 14 s, which the pane and the pitch draw, plus a toast.
- **The pane** (`ui.render` on `Pane`): desktop draws a league header and one SVG per match card (`svg.ts`); the terminal draws text rows with a flashing marquee for celebrations.
- **The pitch** (`ui.render` on `AbovePrompt`): `pitch.ts` holds the choreography as pure functions of time (`playAt`, `goalAt`). The desktop samples them every 0.1 s into SMIL keyframes once, so the SVG animates itself with no redraws. The terminal samples them every 125 ms into a `Raster` of quadrant characters. The engine's own band (`next(e)`) is drawn below the pitch, unchanged.

## Rules that trip people up

- **Every call to `$` lives in `register.tsx`.** The validator refuses a module that passes `$` into a function imported from another file. `espn.ts`, `svg.ts` and `pitch.ts` stay pure.
- **Never use `isInteractive` on desktop `Svg`.** The desktop draws an interactive Svg in an iframe with no size (the browser's 300×150 default, so cards shrink into white space), and its sanitizer strips every `href` that isn't `#…`, which removes the crests. A plain Svg is drawn as an `<img>`: it keeps its own size, shrinks to fit, keeps the `data:` crests, and still runs SMIL animations.
- **Desktop widths come from `bodyColumns`.** A desktop cell is `1ch` of the 12–13 px code font, and the count rounds down, so `drawWidth` errs wide; an `<img>` only ever shrinks to fit.
- **Send the mod's User-Agent.** Claude Code's fetch sends `Bun/x.y.z` by default, and ESPN's CDN answers that with 403.
- **`$.http.fetch` returns text only.** Crests come through `curl … | base64`, with the URL passed as an argument, never interpolated.
- **Keep ids unique per SVG only.** Each desktop card is its own image, so ids like `card` don't collide in the app. A page that inlines several (like the asset scripts) has to suffix them.

## Adding a competition

Add a `{ key, region, flag, name }` entry to `LEAGUES` in `hooks/espn.ts`, where `key` is ESPN's soccer league slug (the `…/soccer/<key>/scoreboard` path). The order of `LEAGUES` is the order of the pane.
