import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Board, Celebration, Filter, Match } from '../types'
import { LEAGUES, dayLabel, isSameDay, kickoff, leagueOf, parseScoreboard, scoreboardPaths } from './espn'
import { PITCH_ROWS, pitchCells, pitchSvg, toBase64 } from './pitch'
import type { PitchScene } from './pitch'
import { C, goalWord, leagueSvg, matchSvg } from './svg'

const PANE = 'live-scores'
const FAST_MS = 30_000
const SLOW_MS = 10 * 60_000
const CELEBRATE_MS = 14_000
const TICK_MS = 150
const PITCH_FRAME_MS = 125
const PITCH_TURN_MS = 20_000

const board = atom({ plugin: 'live-scores', key: 'board' } as const, { matches: [], fetchedAt: 0, error: '' } as Board)
const celebrations = atom({ plugin: 'live-scores', key: 'celebrations' } as const, [] as Celebration[])
const tick = atom({ plugin: 'live-scores', key: 'tick' } as const, 0)
const filter = atom({ plugin: 'live-scores', key: 'filter' } as const, 'all' as Filter)
const pitch = atom({ plugin: 'live-scores', key: 'pitch' } as const, true)
const pitchTick = atom({ plugin: 'live-scores', key: 'pitchTick' } as const, 0)
const pitchTurn = atom({ plugin: 'live-scores', key: 'pitchTurn' } as const, 0)

let known: Map<string, Match> | undefined
let lastFetch = 0
let lastFull = 0
let fetching: Promise<void> | undefined
let celebrating = 0
let lastStatus: string | undefined
let openedForKickoff = false
// When a terminal last drew the pitch: its frames only advance while one does.
let terminalPitchAt = 0

const isFast = (ms: Match[], now: number) =>
  ms.some(m => m.state === 'in' || (m.state === 'pre' && m.start - now < 15 * 60_000 && now - m.start < 3 * 3600_000))

const shown = (ms: Match[], now: number) =>
  ms.filter(m => m.isDemo || m.state === 'in' || isSameDay(m.start, now))

// On desktop a cell is 1ch of the 12–13 px code font (7.2–7.8 px) and
// bodyColumns rounds down, so (columns + 1) × 7.8 px is at least the pane's
// width. An SVG drawn as an image keeps its own size and only ever shrinks to
// fit (max-width: 100%), so erring wide fills the pane edge to edge.
const CELL_PX = 7.8
const drawWidth = (columns: number | undefined) =>
  Math.round(Math.min(1600, Math.max(300, ((columns || 60) + 1) * CELL_PX)))

const scoreLine = (m: Match) => `${m.home.name} ${m.home.score ?? 0}–${m.away.score ?? 0} ${m.away.name}`

function sorted(ms: Match[]): Match[] {
  const rank = (k: string) => LEAGUES.findIndex(l => l.key === k)

  return [...ms].sort((a, b) => Number(!!b.isDemo) - Number(!!a.isDemo) || rank(a.league) - rank(b.league) || a.start - b.start || a.id.localeCompare(b.id))
}

async function celebrate($: EngineInterface, c: Celebration) {
  celebrating += 1
  await update($, celebrations, list => [...list.filter(x => x.matchId !== c.matchId), c])
  $.clock.after(CELEBRATE_MS, () => {
    celebrating = Math.max(0, celebrating - 1)
    void update($, celebrations, list => list.filter(x => x.id !== c.id))
  })
}

/** Compares a fresh match with what we had and animates whatever changed. */
async function diff($: EngineInterface, before: Match, after: Match) {
  for (const side of ['home', 'away'] as const) {
    const was = before[side].score ?? 0
    const now = after[side].score ?? 0
    const team = after[side]
    if (now > was) {
      const goal = [...after.incidents].reverse().find(i => i.kind === 'goal' && i.side === side)
      const c: Celebration = {
        id: `${after.id}:${side}:${now}:${Date.now()}`,
        matchId: after.id, kind: 'goal', side, at: Date.now(),
        player: goal?.player ?? '', minute: goal?.minute ?? after.status,
      }
      await celebrate($, c)
      const who = c.player ? ` · ${c.player}${goal?.isOwnGoal ? ' (OG)' : goal?.isPenalty ? ' (pen)' : ''} ${c.minute}` : ''
      $.ui.toast(`⚽ ${goalWord(c.id)} ${team.name}!  ${scoreLine(after)}${who}`, { timeoutMs: 9000 })
    } else if (now < was) {
      await celebrate($, { id: `${after.id}:var:${Date.now()}`, matchId: after.id, kind: 'var', side, at: Date.now(), player: '', minute: '' })
      $.ui.toast(`📺 VAR says no! ${team.name}'s goal is chalked off.  ${scoreLine(after)}`, { timeoutMs: 8000 })
    }
    if (after[side].reds > before[side].reds) {
      const red = [...after.incidents].reverse().find(i => i.kind === 'red' && i.side === side)
      await celebrate($, { id: `${after.id}:red:${side}:${after[side].reds}`, matchId: after.id, kind: 'red', side, at: Date.now(), player: red?.player ?? '', minute: red?.minute ?? '' })
      $.ui.toast(`🟥 Off you go! ${red?.player ? `${red.player} (${team.name})` : team.name} sees red ${red?.minute ?? ''}`, { timeoutMs: 7000 })
    }
  }
  if (before.state === 'pre' && after.state === 'in') {
    $.ui.toast(`🟢 Kick-off: ${after.home.name} vs ${after.away.name} (${leagueOf(after.league).name})`, { timeoutMs: 6000 })
    if (!openedForKickoff) {
      openedForKickoff = true
      void $.ui.open({ id: PANE, title: '⚽ Live Scores' })
    }
  }
  if (before.state === 'in' && after.state === 'post') {
    $.ui.toast(`🏁 Full time: ${scoreLine(after)}`, { timeoutMs: 7000 })
  }
}

// ESPN's CDN (Akamai) answers 403 to any User-Agent containing "Bun/", which
// is what the engine's fetch sends by default (Claude Code runs on Bun), so
// every request names the mod instead.
const USER_AGENT = 'live-scores/0.1 (+https://github.com/thickiran/claude-live-scores)'
/** One scoreboard feed, from ESPN's public soccer API. */
async function fetchFeed($: EngineInterface, path: string): Promise<string> {
  const res = await $.http.fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${path}`, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  if (!res.text.trimStart().startsWith('{')) throw new Error('the feed did not answer with JSON')

  return res.text
}

/** Every league's matches; a feed that fails is counted and skipped, its reason kept. */
async function fetchAll($: EngineInterface, isFull: boolean): Promise<{ matches: Match[]; failed: number; reason: string }> {
  let failed = 0
  let reason = ''
  const lists = await Promise.all(LEAGUES.flatMap(l => scoreboardPaths(l.key, isFull).map(async path => {
    try {
      return parseScoreboard(l.key, await fetchFeed($, path))
    } catch (err) {
      failed += 1
      reason ||= err instanceof Error ? err.message : String(err)

      return []
    }
  })))

  return { matches: lists.flat(), failed, reason }
}

/** Fetches when due (or forced); a call made while a fetch runs waits for that one. */
async function refresh($: EngineInterface, isForced = false): Promise<void> {
  if (fetching) return fetching
  const now = Date.now()
  const cur = await read($, board)
  if (fetching) return fetching
  if (!isForced && now - lastFetch < (isFast(cur.matches, now) ? FAST_MS - 2000 : SLOW_MS)) return
  lastFetch = now
  fetching = fetchAndApply($, cur, now, isForced).finally(() => {
    fetching = undefined
  })

  return fetching
}

async function fetchAndApply($: EngineInterface, cur: Board, now: number, isForced: boolean) {
  const isFull = now - lastFull >= SLOW_MS || isForced
  const { matches: fetched, failed, reason } = await fetchAll($, isFull)
  if (isFull) lastFull = now
  // Fresh rows replace what we had; matches only an earlier full fetch saw
  // (next matchday) stay until they are two days old.
  const byId = new Map<string, Match>()
  for (const m of cur.matches) if (!m.isDemo && now - m.start < 2 * 86_400_000) byId.set(m.id, m)
  for (const m of fetched) byId.set(m.id, m)
  const matches = [...byId.values()]
  if (known) {
    for (const m of fetched) {
      const before = known.get(m.id)
      if (before) await diff($, before, m)
    }
  }
  known = new Map(matches.map(m => [m.id, m]))
  const error = fetched.length === 0 && failed > 0 ? `Could not reach ESPN (${failed} feeds failed: ${reason || 'unknown error'})` : ''
  // Demo matches are taken at write time, so a demo started mid-fetch stays.
  await update($, board, b => ({ matches: [...b.matches.filter(m => m.isDemo), ...matches], fetchedAt: Date.now(), error }))
  await showStatus($)
}

async function showStatus($: EngineInterface) {
  const { matches } = await read($, board)
  const live = sorted(matches.filter(m => m.state === 'in'))
  const text = live.length === 0
    ? undefined
    : `⚽ ${live.length} live · ${live.slice(0, 3).map(m => `${m.home.abbr} ${m.home.score ?? 0}-${m.away.score ?? 0} ${m.away.abbr} ${m.status}`).join(' · ')}${live.length > 3 ? ' …' : ''}`
  if (text !== lastStatus) {
    lastStatus = text
    $.ui.status(text)
  }
}


// ---- /scores demo ---------------------------------------------------------

function demoMatch(): Match {
  const team = (id: string, name: string, abbr: string, color: string) => ({
    id, name, abbr, color, alt: '#ffffff', score: 1, isWinner: false, reds: 0,
  })

  return {
    id: 'demo', league: 'eng.1', start: Date.now() - 67 * 60_000, state: 'in', status: "67'",
    home: team('359', 'Arsenal', 'ARS', '#e20520'),
    away: team('357', 'Leeds', 'LEE', '#1d428a'),
    incidents: [], isDemo: true,
  }
}

async function runDemo($: EngineInterface) {
  const m0 = demoMatch()
  await update($, board, b => ({ ...b, matches: [m0, ...b.matches.filter(m => !m.isDemo)] }))
  const step = (ms: number, fn: (m: Match) => Match) => $.clock.after(ms, () => void (async () => {
    const b = await read($, board)
    const before = b.matches.find(m => m.isDemo)
    if (!before) return
    const after = fn(before)
    await update($, board, x => ({ ...x, matches: x.matches.map(m => (m.isDemo ? after : m)) }))
    await diff($, before, after)
    await showStatus($)
  })())
  step(1200, m => ({ ...m, status: "68'", home: { ...m.home, score: 2 }, incidents: [...m.incidents, { kind: 'goal', side: 'home', minute: "68'", player: 'B. Saka', isPenalty: false, isOwnGoal: false }] }))
  step(16_000, m => ({ ...m, status: "74'", away: { ...m.away, reds: 1 }, incidents: [...m.incidents, { kind: 'red', side: 'away', minute: "74'", player: 'E. Ampadu', isPenalty: false, isOwnGoal: false }] }))
  step(31_000, m => ({ ...m, status: "81'", away: { ...m.away, score: 2 }, incidents: [...m.incidents, { kind: 'goal', side: 'away', minute: "81'", player: 'J. Piroe', isPenalty: true, isOwnGoal: false }] }))
  step(46_000, m => ({ ...m, status: "83'", away: { ...m.away, score: 1 }, incidents: m.incidents.slice(0, -1) }))
  step(62_000, m => ({ ...m, state: 'post', status: 'FT', home: { ...m.home, isWinner: true } }))
  $.clock.after(80_000, () => void update($, board, b => ({ ...b, matches: b.matches.filter(m => !m.isDemo) })).then(() => showStatus($)))
}

// ---- The mascot pitch --------------------------------------------------------

/**
 * What the pitch shows: the match of a goal being celebrated, else the live
 * matches in turn (the demo first). Nothing when no match is live.
 */
function featured(matches: Match[], cels: Celebration[], turn: number): PitchScene | undefined {
  const goal = [...cels].reverse().find(c => c.kind === 'goal' && matches.some(m => m.id === c.matchId))
  const scored = goal && matches.find(m => m.id === goal.matchId)
  if (goal && scored) return { match: scored, goal: { side: goal.side, at: goal.at, id: goal.id } }
  const live = sorted(matches.filter(m => m.state === 'in'))

  return live.length === 0 ? undefined : { match: live[turn % live.length]! }
}

// ---- Terminal drawing helpers ----------------------------------------------

const RAINBOW = ['#ff3b3b', '#ff9f1a', '#ffd400', '#16c26b', '#4aa8ff', '#a66bff']

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'scores',
      description: 'Live football scores: top 5 leagues and national teams',
      argumentHint: '[live | all | refresh | demo | pitch | close]',
      immediate: true,
    })
    $.clock.every(FAST_MS, () => void refresh($))
    $.clock.every(TICK_MS, () => {
      if (celebrating > 0) void update($, tick, n => (n + 1) % 1_000_000)
    })
    const saved = await $.store.get('pitch')
    if (typeof saved === 'boolean') await update($, pitch, () => saved)
    // The terminal pitch is drawn frame by frame; the desktop one animates itself.
    $.clock.every(PITCH_FRAME_MS, () => {
      if (Date.now() - terminalPitchAt < 1500) void update($, pitchTick, n => (n + 1) % 1_000_000)
    })
    $.clock.every(PITCH_TURN_MS, () => void update($, pitchTurn, n => (n + 1) % 1_000_000))
    void refresh($, true).then(async () => {
      const { matches } = await read($, board)
      if (matches.some(m => m.state === 'in')) {
        openedForKickoff = true
        void $.ui.open({ id: PANE, title: '⚽ Live Scores' })
      }
    })

    return next(e)
  })

  on('command.run', { command: 'scores' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'close') {
      await $.ui.close({ id: PANE })

      return { text: 'Scores pane closed.' }
    }
    if (arg === 'pitch' || arg === 'pitch on' || arg === 'pitch off') {
      const isOn = arg === 'pitch' ? !(await read($, pitch)) : arg === 'pitch on'
      await update($, pitch, () => isOn)
      await $.store.set('pitch', isOn)

      return { text: isOn ? 'Pitch on: the mascots play the live matches above the prompt.' : 'Pitch off.' }
    }
    if (arg === 'live' || arg === 'all') await update($, filter, () => arg as Filter)
    if (arg === 'refresh') await refresh($, true)
    await $.ui.open({ id: PANE, title: '⚽ Live Scores' })
    if (arg === 'demo') {
      await runDemo($)

      return { text: 'Demo match on: Arsenal vs Leeds. Watch the pane for a goal, a red card, VAR and full time over the next minute.' }
    }
    const { matches } = await read($, board)
    const live = matches.filter(m => m.state === 'in').length

    return { text: live > 0 ? `${live} match${live === 1 ? '' : 'es'} live right now.` : 'No matches live right now; showing today\'s fixtures.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !(await read($, pitch))) return next(e)
    const b = await read($, board)
    const scene = featured(b.matches, await read($, celebrations), await read($, pitchTurn))
    if (!scene) return next(e)
    const els = $.ui.resolve(e) as Record<string, ((props: object) => unknown) | undefined>
    const Box = els.Box as any
    const rest = await next(e)
    if (e.surface === 'terminal' && els.Raster) {
      await read($, pitchTick)
      terminalPitchAt = Date.now()
      const Raster = els.Raster as any
      const columns = Math.max(20, Math.min(512, e.props.bodyColumns))

      return (
        <Box flexDirection="column">
          <Raster key="pitch" columns={columns} rows={PITCH_ROWS} cells={toBase64(pitchCells(scene, columns, Date.now()))} />
          {rest}
        </Box>
      )
    }
    if (!els.Svg) return rest
    const Svg = els.Svg as any

    return (
      <Box flexDirection="column">
        <Svg source={pitchSvg(scene, drawWidth(e.props.bodyColumns))} alt={`Claude mascots playing ${scoreLine(scene.match)}`} />
        {rest}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const b = await read($, board)
    const cels = await read($, celebrations)
    const which = await read($, filter)
    const els = $.ui.resolve(e) as Record<string, (props: object) => unknown>
    const Box = els.Box as any
    const Text = els.Text as any
    const Button = els.Button as any
    const now = Date.now()
    const today = sorted(shown(b.matches, now))
    const live = today.filter(m => m.state === 'in')
    const list = which === 'live' ? live : today
    const celOf = (id: string) => cels.find(c => c.matchId === id)
    const groups: { key: string; matches: Match[] }[] = []
    for (const m of list) {
      const key = m.isDemo ? 'demo' : m.league
      const g = groups.find(x => x.key === key)
      if (g) g.matches.push(m)
      else groups.push({ key, matches: [m] })
    }
    const next = sorted(b.matches.filter(m => m.state === 'pre' && m.start > now)).sort((a, z) => a.start - z.start)[0]
    const updated = b.fetchedAt ? `updated ${kickoff(b.fetchedAt)}` : 'loading…'

    const toolbar = (
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        <Box flexDirection="row" gap={1}>
          <Button key="all" label={`All (${today.length})`} variant={which === 'all' ? 'primary' : undefined} onPress={() => update($, filter, () => 'all' as Filter)} />
          <Button key="live" label={`🔴 Live (${live.length})`} variant={which === 'live' ? 'primary' : undefined} onPress={() => update($, filter, () => 'live' as Filter)} />
        </Box>
        <Box flexDirection="row" gap={1} alignItems="center">
          <Text dimColor>{updated}</Text>
          <Button key="refresh" label="↻" onPress={() => refresh($, true)} />
        </Box>
      </Box>
    )
    const empty = list.length === 0 && (
      <Text dimColor>
        {b.error
          ? b.error
          : !b.fetchedAt
            ? 'Fetching scores…'
            : which === 'live'
              ? 'Nothing live right now.'
              : 'No matches today.'}
        {next && b.fetchedAt ? `  Next up: ${next.home.name} vs ${next.away.name}, ${dayLabel(next.start)} ${kickoff(next.start)} (${leagueOf(next.league).name})` : ''}
      </Text>
    )
    const leagueTitle = (key: string) => key === 'demo' ? { ...leagueOf('eng.1'), region: 'Demo', name: 'Friendly kickabout' } : leagueOf(key)

    if (e.surface === 'terminal') {
      const t = await read($, tick)
      const width = Math.max(30, Math.min(80, e.props.bodyColumns))
      const row = (m: Match) => {
        const cel = celOf(m.id)
        const status = m.state === 'pre' ? (m.status === 'Postp.' ? 'Postp' : kickoff(m.start)) : m.status
        const line = (s: 'home' | 'away') => {
          const team = m[s]
          const other = m[s === 'home' ? 'away' : 'home']
          const isLoser = m.state === 'post' && (team.score ?? 0) < (other.score ?? 0)
          const isHit = cel && cel.side === s
          const flash = isHit && t % 4 < 2
          const bg = flash ? (cel!.kind === 'goal' ? team.color : cel!.kind === 'red' ? C.live : C.var) : undefined

          return (
            <Box flexDirection="row" justifyContent="space-between" backgroundColor={bg}>
              <Text bold={team.isWinner} dimColor={isLoser} wrap="truncate">
                {team.name}{team.reds > 0 ? <Text color={C.live}> {'▮'.repeat(team.reds)}</Text> : ''}
              </Text>
              <Text bold color={isHit && cel!.kind === 'goal' ? C.goal : m.state === 'in' ? C.live : undefined} dimColor={isLoser}>
                {m.state === 'pre' || m.status === 'Postp.' ? '' : String(team.score ?? 0)}
              </Text>
            </Box>
          )
        }
        let banner: unknown = null
        if (cel) {
          const lane = Math.max(10, width - 24)
          const pos = t % lane
          if (cel.kind === 'goal') {
            const word = goalWord(cel.id)
            banner = (
              <Text wrap="truncate">
                {' '.repeat(pos)}⚽{' '.repeat(Math.max(0, lane - pos))}
                {[...word].map((ch, i) => <Text bold color={RAINBOW[(i + t) % RAINBOW.length]}>{ch}</Text>)}
                <Text dimColor> {cel.player} {cel.minute}</Text>
              </Text>
            )
          } else if (cel.kind === 'red') {
            banner = <Text bold color={C.live}>{t % 6 < 3 ? '🟥 RED CARD' : '   RED CARD'} <Text dimColor>{cel.player} {cel.minute}</Text></Text>
          } else {
            banner = <Text bold color={C.var}>{' '.repeat(t % 3)}📺 VAR · NO GOAL</Text>
          }
        }

        return (
          <Box flexDirection="column">
            <Box flexDirection="row">
              <Box width={7}>
                <Text color={m.state === 'in' ? C.live : undefined} dimColor={m.state !== 'in'} bold={m.state === 'in'}>
                  {status}
                </Text>
              </Box>
              <Box flexDirection="column" flexGrow={1}>
                {line('home')}
                {line('away')}
              </Box>
            </Box>
            {banner}
          </Box>
        )
      }

      return (
        <Box flexDirection="column" width={width}>
          {toolbar}
          {empty}
          {groups.map(g => {
            const l = leagueTitle(g.key)
            const n = g.matches.filter(m => m.state === 'in').length

            return (
              <Box flexDirection="column" marginTop={1}>
                <Text>
                  {l.flag} <Text dimColor>{l.region}</Text> <Text bold>{l.name}</Text>
                  {n > 0 ? <Text color={C.live} bold> ● {n} live</Text> : ''}
                </Text>
                {g.matches.map(row)}
              </Box>
            )
          })}
        </Box>
      )
    }

    const Svg = els.Svg as any
    const width = drawWidth(e.props.bodyColumns)

    return (
      <Box flexDirection="column" gap={1}>
        {toolbar}
        {empty}
        {groups.map(g => {
          const l = leagueTitle(g.key)
          const n = g.matches.filter(m => m.state === 'in').length

          return (
            <Box flexDirection="column">
              <Svg source={leagueSvg(l, n, width)} alt={`${l.region} · ${l.name}`} />
              {g.matches.map((m, i) => (
                <Svg
                  source={matchSvg(m, celOf(m.id), { width, isLast: i === g.matches.length - 1 })}
                  alt={`${m.status || kickoff(m.start)} ${scoreLine(m)}`}
                />
              ))}
            </Box>
          )
        })}
      </Box>
    )
  })
}
