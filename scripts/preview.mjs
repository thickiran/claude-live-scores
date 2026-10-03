// Draws today's real scores and the mascot pitch to preview.html, each SVG
// exactly as the desktop app shows it (an <img>, block, max-width 100%).
//
//   node scripts/preview.mjs [out.html] [--width 440]
//
// Needs Node ≥ 22.18 (it runs the mod's .ts files directly) and the network.

import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const out = args.find(a => a.endsWith('.html')) ?? 'preview.html'
const width = Number(args[args.indexOf('--width') + 1]) || 440

// The mod's pure modules, with their relative imports given extensions.
const hooks = new URL('../plugins/live-scores/hooks/', import.meta.url)
const work = mkdtempSync(join(tmpdir(), 'live-scores-preview-'))
for (const f of readdirSync(hooks).filter(f => f.endsWith('.ts'))) {
  writeFileSync(join(work, f), readFileSync(new URL(f, hooks), 'utf8').replace(/from '\.\/(\w+)'/g, "from './$1.ts'"))
}
const espn = await import(pathToFileURL(join(work, 'espn.ts')).href)
const svg = await import(pathToFileURL(join(work, 'svg.ts')).href)
const pitch = await import(pathToFileURL(join(work, 'pitch.ts')).href)

const UA = 'live-scores/0.1 (+https://github.com/thickiran/claude-live-scores)'
const get = async url => {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res
}

const byId = new Map()
await Promise.all(espn.LEAGUES.flatMap(l => espn.scoreboardPaths(l.key, false).map(async path => {
  try {
    for (const m of espn.parseScoreboard(l.key, await (await get(`https://site.api.espn.com/apis/site/v2/sports/soccer/${path}`)).text())) byId.set(m.id, m)
  } catch {}
})))
const now = Date.now()
const rank = k => espn.LEAGUES.findIndex(l => l.key === k)
const today = [...byId.values()]
  .filter(m => m.state === 'in' || espn.isSameDay(m.start, now))
  .sort((a, b) => rank(a.league) - rank(b.league) || a.start - b.start)

const logos = new Map()
await Promise.all([...new Set(today.flatMap(m => [m.home.logo, m.away.logo]))].map(async logo => {
  const url = espn.logoUrl(logo)
  if (!url) return
  try {
    logos.set(logo, Buffer.from(await (await get(url)).arrayBuffer()).toString('base64'))
  } catch {}
}))

const img = source => `<img style="display:block;max-width:100%;border:0" src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}">`
const groups = []
for (const m of today) {
  const g = groups.find(x => x.key === m.league)
  if (g) g.matches.push(m)
  else groups.push({ key: m.league, matches: [m] })
}
const pane = groups.map(g => {
  const live = g.matches.filter(m => m.state === 'in').length
  return `<div style="display:flex;flex-direction:column">${img(svg.leagueSvg(espn.leagueOf(g.key), live, width))}${
    g.matches.map((m, i) => img(svg.matchSvg(m, logos, undefined, { width, isLast: i === g.matches.length - 1 }))).join('')}</div>`
}).join('')
const featured = today.find(m => m.state === 'in') ?? today[0]
const pitchHtml = featured ? img(pitch.pitchSvg({ match: featured }, Math.max(width, 640))) : '<p>No match today to put on the pitch.</p>'

writeFileSync(out, `<!doctype html><meta charset="utf-8"><title>Live Scores preview</title>
<body style="margin:0;padding:24px;background:#1f1e1d;color:#c9c5bd;font:13px -apple-system,sans-serif">
  <h3 style="margin:0 0 12px">The pane (${today.length} matches today)</h3>
  <div style="width:${width}px;display:flex;flex-direction:column;gap:10px">${pane || '<p>No matches today.</p>'}</div>
  <h3 style="margin:28px 0 12px">The pitch${featured ? `: ${featured.home.name} v ${featured.away.name}` : ''}</h3>
  <div style="width:${Math.max(width, 640)}px">${pitchHtml}</div>
</body>`)
console.log(`${out}: ${today.length} matches today, ${today.filter(m => m.state === 'in').length} live`)
