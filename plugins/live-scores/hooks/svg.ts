import type { Celebration, Match, Side } from '../types'
import { kickoff } from './espn'
import type { League } from './espn'

// A dark score-app palette.
export const C = {
  card: '#1b1e25',
  head: '#262a33',
  line: '#2f333d',
  text: '#ffffff',
  sub: '#9aa0ab',
  live: '#ff3b3b',
  goal: '#16c26b',
  accent: '#374df5',
  var: '#ffc832',
}

/** The width a card is laid out at when the caller does not say. */
export const DEFAULT_WIDTH = 460
const H = 64
const HEAD_H = 36
const RADIUS = 8
export const FONT = '-apple-system, BlinkMacSystemFont, Inter, Segoe UI, Helvetica, Arial, sans-serif'
// Every row's text is vertically centred on these lines (dominant-baseline
// central), so crests, names, scores and overlays share one axis.
const ROW = { home: 21, away: 43 } as const
const X_CREST = 86
const X_NAME = 104
const MID = 'dominant-baseline="central"'

/** The right edge scores are drawn against, for a card `w` wide. */
const scoreX = (w: number) => w - 22

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// Advance widths of the system UI font at 1em, close enough that text drawn
// with `textLength` (pills) barely stretches and markers placed after a name
// land beside it.
function em(ch: string): number {
  if (' '.includes(ch)) return 0.27
  if ("il.,:;'|!’".includes(ch)) return 0.25
  if ('fjrtI'.includes(ch)) return 0.34
  if ('mw'.includes(ch)) return 0.86
  if ('MW'.includes(ch)) return 0.95
  if ('-–·()'.includes(ch)) return 0.36
  if (/[0-9]/.test(ch)) return 0.6
  if (/[A-Z]/.test(ch)) return 0.68
  if (/[a-z]/.test(ch)) return 0.54

  return 0.62
}

export const measure = (s: string, size: number, weight = 400) =>
  [...s].reduce((n, ch) => n + em(ch), 0) * size * (weight >= 800 ? 1.12 : weight >= 600 ? 1.09 : weight >= 500 ? 1.03 : 1)

/** `s`, cut with an ellipsis until it fits `maxW`. */
function fit(s: string, size: number, weight: number, maxW: number): string {
  if (measure(s, size, weight) <= maxW) return s
  const chars = [...s]
  while (chars.length > 1 && measure(`${chars.join('').trimEnd()}…`, size, weight) > maxW) chars.pop()

  return `${chars.join('').trimEnd()}…`
}

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)

  return h >>> 0
}

// Deterministic per celebration, so a redraw yields the same markup.
function rng(seed: string) {
  let x = hash(seed) || 1

  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5

    return ((x >>> 0) % 10_000) / 10_000
  }
}

const GOAL_WORDS = ['GOOOAL!', 'GOLAZO!', 'BACK OF THE NET!', 'GET IN!', 'WHAT A STRIKE!', 'SCENES!']

export const goalWord = (id: string) => GOAL_WORDS[hash(id) % GOAL_WORDS.length]!

/** A pill: rounded rect with text pinned to its measured width, centred both ways. */
function pill(x: number, cy: number, label: string, fill: string, opts: { size?: number; icon?: string; iconW?: number } = {}) {
  const size = opts.size ?? 11
  const tw = measure(label, size, 700)
  const iconW = opts.icon ? (opts.iconW ?? 12) + 4 : 0
  const w = tw + iconW + 18
  const h = size + 9

  return {
    w,
    svg: `<g transform="translate(${x.toFixed(1)} ${cy})">
      <rect y="${-h / 2}" width="${w.toFixed(1)}" height="${h}" rx="${h / 2}" fill="${fill}"/>
      ${opts.icon ? `<g transform="translate(${9 + (opts.iconW ?? 12) / 2} 0)">${opts.icon}</g>` : ''}
      <text x="${9 + iconW}" y="0.5" ${MID} font-size="${size}" font-weight="700" fill="#fff" textLength="${tw.toFixed(1)}" lengthAdjust="spacingAndGlyphs">${esc(label)}</text>
    </g>`,
  }
}

export function leagueSvg(l: League, live: number, w = DEFAULT_WIDTH): string {
  const label = `${live} LIVE`
  const lw = measure(label, 11, 700)
  const bw = lw + 26
  const badge = live > 0
    ? `<g transform="translate(${(w - 12 - bw).toFixed(1)} ${HEAD_H / 2})">
         <rect y="-9" width="${bw.toFixed(1)}" height="18" rx="9" fill="${C.live}"/>
         <circle cx="10" r="3" fill="#fff"><animate attributeName="opacity" values="1;.2;1" dur="1.2s" repeatCount="indefinite"/></circle>
         <text x="19" y="0.5" ${MID} font-size="11" font-weight="700" fill="#fff" textLength="${lw.toFixed(1)}" lengthAdjust="spacingAndGlyphs">${label}</text>
       </g>`
    : ''
  const room = w - 42 - (live > 0 ? bw + 20 : 12)
  const region = fit(l.region, 12, 400, room * 0.45)
  const name = fit(l.name, 13, 700, room - measure(region, 12) - 8)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${HEAD_H}" viewBox="0 0 ${w} ${HEAD_H}" font-family="${FONT}">
  <path d="M0,${HEAD_H} V${RADIUS} Q0,0 ${RADIUS},0 H${w - RADIUS} Q${w},0 ${w},${RADIUS} V${HEAD_H} Z" fill="${C.head}"/>
  <text x="24" y="${HEAD_H / 2 + 0.5}" ${MID} font-size="15" text-anchor="middle">${l.flag}</text>
  <text x="42" y="${HEAD_H / 2 + 0.5}" ${MID} font-size="12"><tspan fill="${C.sub}">${esc(region)}</tspan><tspan dx="8" font-size="13" font-weight="700" fill="${C.text}">${esc(name)}</tspan></text>
  ${badge}
</svg>`
}

function crest(s: Side, cy: number, logo: string | undefined): string {
  const fallback = `<circle cx="${X_CREST}" cy="${cy}" r="9" fill="${s.color}"/>
    <text x="${X_CREST}" y="${cy + 0.5}" ${MID} font-size="7" font-weight="800" fill="#fff" text-anchor="middle">${esc(s.abbr.slice(0, 3))}</text>`

  return logo
    ? `${fallback}<image href="data:image/png;base64,${logo}" x="${X_CREST - 10}" y="${cy - 10}" width="20" height="20"/>`
    : fallback
}

function statusCell(m: Match): string {
  const mid = (H - 1) / 2 + 0.5
  if (m.state === 'in') {
    const minute = m.status.replace(/'$/, '')
    const tick = m.status.endsWith("'")
      ? `${esc(minute)}<tspan>'<animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite"/></tspan>`
      : esc(m.status)

    return `<text x="30" y="${mid}" ${MID} font-size="12" font-weight="700" fill="${C.live}" text-anchor="middle">${tick}</text>`
  }
  if (m.state === 'post') {
    return `<text x="30" y="${ROW.home}" ${MID} font-size="11" fill="${C.sub}" text-anchor="middle">${kickoff(m.start)}</text>
      <text x="30" y="${ROW.away}" ${MID} font-size="12" font-weight="600" fill="${C.sub}" text-anchor="middle">${esc(m.status)}</text>`
  }

  return `<text x="30" y="${mid}" ${MID} font-size="12" fill="${C.sub}" text-anchor="middle">${m.status === 'Postp.' ? 'Postp.' : kickoff(m.start)}</text>`
}

const scoreText = (m: Match, s: Side) => (s.score === null || m.state === 'pre' || m.status === 'Postp.' ? '' : String(s.score))

function teamLine(m: Match, s: Side, cy: number, logo: string | undefined, isLoser: boolean, w: number): string {
  const weight = s.isWinner ? 700 : 500
  const right = scoreX(w) - 34 - s.reds * 9
  const name = fit(s.name, 14, weight, right - X_NAME)
  const after = X_NAME + measure(name, 14, weight) + 8
  const reds = Array.from({ length: s.reds }, (_, i) =>
    `<rect x="${(after + i * 9).toFixed(1)}" y="${cy - 5}" width="7" height="10" rx="1.5" fill="${C.live}"/>`).join('')
  const nameColor = isLoser ? C.sub : C.text
  const scoreColor = m.state === 'in' ? C.live : isLoser ? C.sub : C.text

  return `${crest(s, cy, logo)}
  <text x="${X_NAME}" y="${cy + 0.5}" ${MID} font-size="14" font-weight="${weight}" fill="${nameColor}">${esc(name)}</text>${reds}
  <text x="${scoreX(w)}" y="${cy + 0.5}" ${MID} font-size="15" font-weight="700" fill="${scoreColor}" text-anchor="end">${scoreText(m, s)}</text>`
}

export function ball(r = 8): string {
  const k = r / 8

  return `<g transform="scale(${k})">
    <circle r="8" fill="#fff" stroke="#111" stroke-width="1"/>
    <polygon points="0,-3.4 3.2,-1 2,2.8 -2,2.8 -3.2,-1" fill="#111"/>
    <path d="M0,-3.4 L0,-8 M3.2,-1 L7.6,-2.4 M2,2.8 L4.6,6.4 M-2,2.8 L-4.6,6.4 M-3.2,-1 L-7.6,-2.4" stroke="#111" stroke-width="1"/>
  </g>`
}

const redCardIcon = `<rect x="-3.5" y="-5" width="7" height="10" rx="1.2" fill="#fff"/><rect x="-2.3" y="-3.8" width="4.6" height="7.6" rx=".6" fill="${C.live}"/>`

/** Where a side's score is drawn: its centre and width. */
function scoreBox(m: Match, s: Side, cy: number, w: number) {
  const sw = Math.max(measure(scoreText(m, s) || '0', 15, 700), 9)

  return { cx: scoreX(w) - sw / 2, cy, w: sw }
}

function goalOverlay(m: Match, c: Celebration, w: number): string {
  const s = c.side === 'home' ? m.home : m.away
  const cy = ROW[c.side]
  const box = scoreBox(m, s, cy, w)
  const r = rng(c.id)
  const word = goalWord(c.id)
  const ww = Math.min(measure(word, 30, 900) * 1.05, w - 40)
  const palette = [s.color, '#ffd400', '#16c26b', '#ff3b3b', '#4aa8ff', '#ffffff', '#ff7ad9']
  const confetti = Array.from({ length: 26 }, (_, i) => {
    const ang = r() * Math.PI * 2
    const dist = 30 + r() * 70
    const dx = Math.cos(ang) * dist
    const dy = Math.sin(ang) * dist * 0.6 - 10
    const fall = 26 + r() * 30
    const dur = (1.3 + r() * 1.1).toFixed(2)
    const rot = Math.round((r() - 0.5) * 1080)
    const col = palette[i % palette.length]
    const cw = (3 + r() * 4).toFixed(1)

    return `<g transform="translate(${box.cx.toFixed(1)} ${cy})"><g opacity="0">
      <rect x="-2" y="-1.5" width="${cw}" height="3" fill="${col}"/>
      <animateMotion begin="1s" dur="${dur}s" fill="freeze" path="M0,0 Q${(dx / 2).toFixed(1)},${(dy - 20).toFixed(1)} ${dx.toFixed(1)},${(dy + fall).toFixed(1)}"/>
      <animateTransform attributeName="transform" type="rotate" additive="sum" from="0" to="${rot}" begin="1s" dur="${dur}s" fill="freeze"/>
      <animate attributeName="opacity" values="1;1;0" keyTimes="0;.7;1" begin="1s" dur="${dur}s" fill="freeze"/>
    </g></g>`
  }).join('')
  const arc = `M70,${H + 12} Q${((70 + box.cx) / 2).toFixed(1)},-40 ${box.cx.toFixed(1)},${cy}`
  const chipText = `${c.player || 'Goal'}${c.minute ? ` ${c.minute}` : ''}`
  const chipW = measure(chipText, 11, 700) + 16 + 18
  const chip = pill(scoreX(w) - box.w - 14 - chipW, cy, chipText, C.goal, { icon: ball(6), iconW: 12 })
  const popW = box.w + 14
  const score = scoreText(m, s)

  return `
  <rect width="${w}" height="${H}" fill="${s.color}" opacity="0">
    <animate attributeName="opacity" values="0;.55;0;.45;0;.35;0" dur="2.2s" fill="freeze"/>
  </rect>
  <g opacity="0">
    <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.1;.85;1" begin=".25s" dur="2.6s" fill="freeze"/>
    <animateTransform attributeName="transform" type="translate" values="${w + ww / 2 + 10},0;${w / 2 + 12},0;${w / 2 - 12},0;${-ww / 2 - 10},0" keyTimes="0;.25;.75;1" begin=".25s" dur="2.6s" fill="freeze"/>
    <text x="0" y="${H / 2 + 0.5}" ${MID} text-anchor="middle" font-size="30" font-style="italic" font-weight="900" fill="${C.text}" stroke="${s.color}" stroke-width="5" paint-order="stroke" textLength="${ww.toFixed(1)}" lengthAdjust="spacingAndGlyphs">${esc(word)}</text>
  </g>
  <g opacity="0">
    <set attributeName="opacity" to="1" begin="0s"/>
    <set attributeName="opacity" to="0" begin="1s"/>
    <animateMotion dur="1s" path="${arc}" fill="freeze"/>
    <g><animateTransform attributeName="transform" type="rotate" from="0" to="900" dur="1s" fill="freeze"/>${ball()}</g>
  </g>
  <circle cx="${box.cx.toFixed(1)}" cy="${cy}" r="0" fill="none" stroke="${C.goal}" stroke-width="3" opacity="0">
    <animate attributeName="r" from="2" to="34" begin="1s" dur=".7s" fill="freeze"/>
    <animate attributeName="opacity" from="1" to="0" begin="1s" dur=".7s" fill="freeze"/>
  </circle>
  <g transform="translate(${box.cx.toFixed(1)} ${cy})">
    <g opacity="0">
      <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.05;.8;1" begin="1s" dur="3s" fill="freeze"/>
      <animateTransform attributeName="transform" type="scale" values="1;1.9;.85;1.25;1" keyTimes="0;.25;.5;.75;1" begin="1s" dur=".9s"/>
      <rect x="${(-popW / 2).toFixed(1)}" y="-11" width="${popW.toFixed(1)}" height="22" rx="5" fill="${C.goal}"/>
      <text x="0" y="0.5" ${MID} text-anchor="middle" font-size="15" font-weight="800" fill="#fff">${score}</text>
    </g>
  </g>
  ${confetti}
  <g opacity="0">
    <animate attributeName="opacity" from="0" to="1" begin="1.3s" dur=".3s" fill="freeze"/>
    ${chip.svg}
  </g>`
}

function redOverlay(m: Match, c: Celebration, w: number): string {
  const s = c.side === 'home' ? m.home : m.away
  const cy = ROW[c.side]
  const box = scoreBox(m, s, cy, w)
  const label = `RED CARD${c.player ? ` · ${c.player}` : ''}`
  const chipW = measure(label, 11, 700) + 16 + 18
  const chipX = scoreX(w) - box.w - 14 - chipW
  const chip = pill(chipX, cy, label, C.live, { icon: redCardIcon, iconW: 8 })

  return `
  <rect width="${w}" height="${H}" fill="${C.live}" opacity="0">
    <animate attributeName="opacity" values="0;.35;0;.25;0" dur="1.4s" fill="freeze"/>
  </rect>
  <g transform="translate(${(chipX - 26).toFixed(1)} ${H / 2})">
    <g opacity="0">
      <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.1;.8;1" dur="2.4s" fill="freeze"/>
      <animateTransform attributeName="transform" type="rotate" values="-160;12;-6;0" keyTimes="0;.25;.35;.45" dur="2.4s" fill="freeze"/>
      <rect x="-13" y="-18" width="26" height="36" rx="3" fill="${C.live}" stroke="#fff" stroke-width="2"/>
    </g>
  </g>
  <g opacity="0">
    <animate attributeName="opacity" from="0" to="1" begin=".5s" dur=".3s" fill="freeze"/>
    ${chip.svg}
  </g>`
}

function varOverlay(w: number): string {
  const label = 'VAR · NO GOAL'
  const tw = measure(label, 18, 900) + 12 * 1.5
  const icon = 26
  const bw = tw + icon + 34
  const bh = 36

  return `
  <rect width="${w}" height="${H}" fill="${C.var}" opacity="0">
    <animate attributeName="opacity" values="0;.3;0" dur=".8s" fill="freeze"/>
  </rect>
  <g transform="translate(${w / 2} ${H / 2})">
    <animate attributeName="opacity" values="1;1;0" keyTimes="0;.85;1" dur="4s" fill="freeze"/>
    <animateTransform attributeName="transform" type="translate" additive="sum" values="0,0;-6,0;6,0;-5,0;5,0;-3,0;0,0" dur=".6s" begin=".2s" repeatCount="3"/>
    <rect x="${(-bw / 2).toFixed(1)}" y="${-bh / 2}" width="${bw.toFixed(1)}" height="${bh}" rx="8" fill="#000" stroke="${C.var}" stroke-width="2"/>
    <g transform="translate(${(-bw / 2 + 14 + icon / 2).toFixed(1)} 0)" fill="none" stroke="${C.var}" stroke-width="2">
      <rect x="-12" y="-9" width="24" height="15" rx="2"/>
      <path d="M-5,10 H5 M0,6 V10"/>
    </g>
    <text x="${(-bw / 2 + 14 + icon + 10).toFixed(1)}" y="0.5" ${MID} font-size="18" font-weight="900" fill="${C.var}" letter-spacing="1.5" textLength="${tw.toFixed(1)}" lengthAdjust="spacingAndGlyphs">${label}</text>
  </g>`
}

export type CardOptions = {
  /** The width to lay the card out at, in CSS pixels. */
  width?: number
  /** The last card of its league: rounded bottom corners, no divider. */
  isLast?: boolean
}

export function matchSvg(m: Match, logos: Map<string, string>, cel?: Celebration, opts: CardOptions = {}): string {
  const w = Math.round(opts.width ?? DEFAULT_WIDTH)
  const hs = m.home.score ?? 0
  const as = m.away.score ?? 0
  const done = m.state === 'post'
  const overlay = !cel ? '' : cel.kind === 'goal' ? goalOverlay(m, cel, w) : cel.kind === 'red' ? redOverlay(m, cel, w) : varOverlay(w)
  // The last card closes its league's block: everything is clipped to a shape
  // with rounded bottom corners, flashes and confetti included.
  const shape = opts.isLast
    ? `M0,0 H${w} V${H - RADIUS} Q${w},${H} ${w - RADIUS},${H} H${RADIUS} Q0,${H} 0,${H - RADIUS} Z`
    : `M0,0 H${w} V${H} H0 Z`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" font-family="${FONT}">
  <clipPath id="card"><path d="${shape}"/></clipPath>
  <g clip-path="url(#card)">
  <path d="${shape}" fill="${C.card}"/>
  ${opts.isLast ? '' : `<rect y="${H - 1}" width="${w}" height="1" fill="${C.line}"/>`}
  ${m.state === 'in' ? `<rect width="3" height="${H}" fill="${C.live}"/>` : ''}
  ${statusCell(m)}
  <rect x="60" y="12" width="1" height="${H - 24}" fill="${C.line}"/>
  ${teamLine(m, m.home, ROW.home, logos.get(m.home.logo), done && hs < as, w)}
  ${teamLine(m, m.away, ROW.away, logos.get(m.away.logo), done && as < hs, w)}
  ${overlay}
  </g>
</svg>`
}
