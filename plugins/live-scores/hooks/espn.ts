import type { Incident, Match, MatchState, Side } from '../types'

export type League = { key: string; region: string; flag: string; name: string }

// Display order: the big five first, then national-team competitions.
export const LEAGUES: League[] = [
  { key: 'eng.1', region: 'England', flag: '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}', name: 'Premier League' },
  { key: 'esp.1', region: 'Spain', flag: '🇪🇸', name: 'LaLiga' },
  { key: 'ita.1', region: 'Italy', flag: '🇮🇹', name: 'Serie A' },
  { key: 'ger.1', region: 'Germany', flag: '🇩🇪', name: 'Bundesliga' },
  { key: 'fra.1', region: 'France', flag: '🇫🇷', name: 'Ligue 1' },
  { key: 'fifa.world', region: 'World', flag: '🌍', name: 'FIFA World Cup' },
  { key: 'uefa.euro', region: 'Europe', flag: '🇪🇺', name: 'EURO' },
  { key: 'conmebol.america', region: 'South America', flag: '🌎', name: 'Copa América' },
  { key: 'caf.nations', region: 'Africa', flag: '🌍', name: 'Africa Cup of Nations' },
  { key: 'uefa.nations', region: 'Europe', flag: '🇪🇺', name: 'UEFA Nations League' },
  { key: 'fifa.worldq.uefa', region: 'Europe', flag: '🇪🇺', name: 'World Cup Qual.' },
  { key: 'fifa.worldq.conmebol', region: 'South America', flag: '🌎', name: 'World Cup Qual.' },
  { key: 'fifa.worldq.concacaf', region: 'North & Central America', flag: '🌎', name: 'World Cup Qual.' },
  { key: 'fifa.worldq.afc', region: 'Asia', flag: '🌏', name: 'World Cup Qual.' },
  { key: 'fifa.worldq.caf', region: 'Africa', flag: '🌍', name: 'World Cup Qual.' },
  { key: 'uefa.euroq', region: 'Europe', flag: '🇪🇺', name: 'EURO Qualification' },
  { key: 'fifa.friendly', region: 'World', flag: '🌍', name: 'International Friendlies' },
]

export const leagueOf = (key: string) => LEAGUES.find(l => l.key === key) ?? LEAGUES[0]!

const ymd = (d: Date) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`

function side(c: any, reds: number): Side {
  const t = c?.team ?? {}
  const raw = c?.score
  const score = raw === undefined || raw === null || raw === '' ? null : Number(raw)

  return {
    id: String(t.id ?? ''),
    name: String(t.shortDisplayName ?? t.displayName ?? t.name ?? '?'),
    abbr: String(t.abbreviation ?? '???'),
    color: /^[0-9a-f]{6}$/i.test(t.color ?? '') ? `#${t.color}` : '#5c6270',
    alt: /^[0-9a-f]{6}$/i.test(t.alternateColor ?? '') ? `#${t.alternateColor}` : '#ffffff',
    score: Number.isFinite(score) ? score : null,
    isWinner: c?.winner === true,
    reds,
  }
}

function parseEvent(league: string, ev: any): Match | undefined {
  const comp = ev?.competitions?.[0]
  const cs: any[] = comp?.competitors ?? []
  const h = cs.find(c => c.homeAway === 'home')
  const a = cs.find(c => c.homeAway === 'away')
  if (!h || !a) return undefined
  const type = ev.status?.type ?? {}
  const state: MatchState = type.state === 'in' || type.state === 'post' ? type.state : 'pre'
  const sideOf = (teamId: string): 'home' | 'away' => (String(teamId) === String(a.team?.id) ? 'away' : 'home')
  const incidents: Incident[] = []
  for (const d of comp.details ?? []) {
    if (!d.scoringPlay && !d.redCard) continue
    if (d.shootout) continue
    incidents.push({
      kind: d.scoringPlay ? 'goal' : 'red',
      side: sideOf(d.team?.id),
      minute: String(d.clock?.displayValue ?? ''),
      player: String(d.athletesInvolved?.[0]?.shortName ?? d.athletesInvolved?.[0]?.displayName ?? ''),
      isPenalty: d.penaltyKick === true,
      isOwnGoal: d.ownGoal === true,
    })
  }
  const reds = (s: 'home' | 'away') => incidents.filter(i => i.kind === 'red' && i.side === s).length
  let status = String(type.shortDetail ?? '')
  if (state === 'in' && /half/i.test(type.description ?? '') && /time/i.test(type.description ?? '')) status = 'HT'
  if (state === 'post') status = /pen/i.test(status) ? 'AP' : /aet|extra/i.test(status) ? 'AET' : 'FT'
  if (/postponed|canceled|cancelled/i.test(type.description ?? '')) status = 'Postp.'

  return {
    id: String(ev.id),
    league,
    start: Date.parse(ev.date),
    state,
    status,
    home: side(h, reds('home')),
    away: side(a, reds('away')),
    incidents,
  }
}

/**
 * The scoreboard feeds for one league, as paths under ESPN's soccer API
 * (`https://site.api.espn.com/apis/site/v2/sports/soccer/`). ESPN takes one
 * date per request (a range is a 400), dated in US time, so the local day
 * needs yesterday's feed too; the undated feed is the league's next
 * matchday, for "next up".
 */
export function scoreboardPaths(league: string, isFull: boolean, now = new Date()): string[] {
  const days = [ymd(now), ymd(new Date(now.getTime() - 86_400_000))]
  const paths = days.map(d => `${league}/scoreboard?dates=${d}`)

  return isFull ? [...paths, `${league}/scoreboard`] : paths
}

export function parseScoreboard(league: string, text: string): Match[] {
  const data = JSON.parse(text)

  return ((data.events ?? []) as any[]).map(ev => parseEvent(league, ev)).filter((m): m is Match => !!m)
}

export const isSameDay = (a: number, b: number) => {
  const x = new Date(a)
  const y = new Date(b)

  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}

export const kickoff = (t: number) => {
  const d = new Date(t)

  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export const dayLabel = (t: number) =>
  new Date(t).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

