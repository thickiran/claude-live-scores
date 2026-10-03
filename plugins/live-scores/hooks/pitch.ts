import type { Match, Side } from '../types'
import { FONT, ball, esc, measure } from './svg'

// A side-on kickabout between Claude mascots in the featured match's kits:
// each team has an outfielder and a keeper. One choreography, written as pure
// functions of time, drives both surfaces: the desktop SVG samples it into
// SMIL keyframes once (the image then animates itself), the terminal samples
// it every frame into block pixels.

// ---- The mascot ----------------------------------------------------------

// Clawd, Claude Code's mascot, in a kit. H head, E eye, h hand, A sleeve,
// S shirt, P shorts, L sock, B boot. Two leg frames make the scuttle.
const BODY = [
  '...HHHHHHHHHHHH...',
  '...HHEHHHHHHEHH...',
  '.hASSSSSSSSSSSSAh.',
  '...SSSSSSSSSSSS...',
  '...PPPPPPPPPPPP...',
]
const LEGS = [
  ['....L.L....L.L....', '....B.B....B.B....'],
  ['...L.L......L.L...', '...B.B......B.B...'],
]
const SPRITE_W = 18
const SPRITE_H = BODY.length + 2

const CLAUDE = '#d97757'
const EYE = '#1d1d1f'
const BOOT = '#222326'
const GLOVE = '#f4f4f4'

export type Kit = { shirt: string; shorts: string; socks: string }

const rgb = (hex: string) => [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
const distance = (a: string, b: string) => {
  const [r1, g1, b1] = rgb(a)
  const [r2, g2, b2] = rgb(b)

  return Math.hypot(r1 - r2, g1 - g2, b1 - b2)
}

/** Both teams' kits; on a clash of shirts the away side wears its second colour. */
export function kits(home: Side, away: Side): { home: Kit; away: Kit } {
  const h: Kit = { shirt: home.color, shorts: home.alt, socks: home.color }
  const clash = distance(home.color, away.color) < 110

  return {
    home: h,
    away: clash
      ? { shirt: away.alt, shorts: away.color, socks: away.alt }
      : { shirt: away.color, shorts: away.alt, socks: away.color },
  }
}

function paletteOf(kit: Kit, isKeeper: boolean): Record<string, string> {
  return { H: CLAUDE, E: EYE, h: isKeeper ? GLOVE : CLAUDE, A: kit.shirt, S: kit.shirt, P: kit.shorts, L: kit.socks, B: BOOT }
}

/** The sprite's pixels, legs in frame `leg`: [x, y, colour]. */
function spritePixels(kit: Kit, isKeeper: boolean, leg: 0 | 1): [number, number, string][] {
  const pal = paletteOf(kit, isKeeper)
  const rows = [...BODY, ...LEGS[leg]!]
  const out: [number, number, string][] = []
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch !== '.') out.push([x, y, pal[ch]!])
  }))

  return out
}

// ---- The choreography ----------------------------------------------------

// Positions are field units: -1 and 1 sit just in front of the goals, the
// keepers stand at ±KEEPER and the goal lines at ±GOAL_LINE. Heights are in
// sprite heights above the grass.
const KEEPER = 1.12
const GOAL_LINE = 1.27
export const PLAY_SECONDS = 10
export const GOAL_SECONDS = 8

type Pose = { f: number; lift: number; tilt: number }
export type Frame = { home: Pose; away: Pose; homeKeeper: Pose; awayKeeper: Pose; ball: { f: number; lift: number } }

const smooth = (s: number) => s * s * (3 - 2 * s)

/** Piecewise interpolation through [time, value] keys, eased between them. */
function track(keys: [number, number][], t: number): number {
  if (t <= keys[0]![0]) return keys[0]![1]
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i]!
    const [t0, v0] = keys[i - 1]!
    if (t <= t1) return v0 + (v1 - v0) * smooth((t - t0) / (t1 - t0))
  }

  return keys.at(-1)![1]
}

/** A bump from 0 up to `h` and back between t0 and t1. */
const bump = (t: number, t0: number, t1: number, h: number) =>
  t <= t0 || t >= t1 ? 0 : h * Math.sin((Math.PI * (t - t0)) / (t1 - t0))

/** A flight from (f0, l0) to (f1, l1) between t0 and t1 that rises `peak` above the straight line. */
function flight(t: number, t0: number, t1: number, f0: number, l0: number, f1: number, l1: number, peak: number) {
  const s = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)))

  return { f: f0 + (f1 - f0) * s, lift: l0 + (l1 - l0) * s + 4 * peak * s * (1 - s) }
}

const A_KEYS: [number, number][] = [[0, -0.35], [1.6, 0.45], [2.6, 0.25], [4.2, -0.2], [5.4, -0.12], [7.4, 0.62], [7.7, 0.64], [9, 0.1], [10, -0.35]]
const B_KEYS: [number, number][] = [[0, 0.35], [1.5, 0.58], [2.7, -0.3], [4.2, -0.62], [4.6, -0.58], [5.6, -0.25], [7.4, 0.4], [8.6, 0.45], [10, 0.35]]

/**
 * The kickabout at `t` seconds (looping): the home mascot dribbles, the away
 * one tackles and shoots, the home keeper saves, the home mascot rattles the
 * crossbar, and the ball rolls back to the start. `carry` is how far ahead of
 * a dribbler the ball runs, in field units; `crossbar` is the bar's height.
 */
export function playAt(time: number, carry: number, crossbar: number): Frame {
  const t = ((time % PLAY_SECONDS) + PLAY_SECONDS) % PLAY_SECONDS
  const a = track(A_KEYS, t)
  const b = track(B_KEYS, t)
  const A = (u: number) => track(A_KEYS, u)
  const B = (u: number) => track(B_KEYS, u)
  let ballAt: { f: number; lift: number }
  if (t < 1.6) ballAt = { f: a + carry, lift: 0.06 * Math.abs(Math.sin(t * 9)) }
  else if (t < 2.7) ballAt = flight(t, 1.6, 2.7, A(1.6) + carry, 0, B(2.7) - carry, 0, 1.25)
  else if (t < 4.2) ballAt = { f: b - carry, lift: 0.06 * Math.abs(Math.sin(t * 9)) }
  else if (t < 4.6) ballAt = flight(t, 4.2, 4.6, B(4.2) - carry, 0, -KEEPER + 0.06, 0.55, 0.35)
  else if (t < 5.4) ballAt = flight(t, 4.6, 5.4, -KEEPER + 0.06, 0.55, A(5.4) + carry, 0, 0.9)
  else if (t < 7.4) ballAt = { f: a + carry, lift: 0.06 * Math.abs(Math.sin(t * 9)) }
  else if (t < 7.9) ballAt = flight(t, 7.4, 7.9, A(7.4) + carry, 0, GOAL_LINE - 0.02, crossbar, 0.45)
  else if (t < 8.9) ballAt = flight(t, 7.9, 8.9, GOAL_LINE - 0.02, crossbar, 0.25, 0, 0.5)
  else ballAt = { f: 0.25 + (A(10) + carry - 0.25) * smooth((t - 8.9) / 1.1), lift: 0 }

  return {
    home: { f: a, lift: bump(t, 7.35, 7.65, 0.14), tilt: 0 },
    away: { f: b, lift: bump(t, 1.45, 1.75, 0.14) + bump(t, 4.1, 4.4, 0.14), tilt: 0 },
    homeKeeper: { f: -KEEPER + 0.03 * Math.sin((2 * Math.PI * t) / 2.2), lift: bump(t, 4.3, 4.9, 0.55), tilt: 0 },
    awayKeeper: { f: KEEPER + 0.03 * Math.sin((2 * Math.PI * t) / 2.6 + 1), lift: bump(t, 7.5, 8.1, 0.8), tilt: 0 },
    ball: ballAt,
  }
}

/**
 * A goal for `side` at `t` seconds since it went in (held at the end): the
 * scorer bursts through and finds the net, the beaten keeper dives the wrong
 * way and stays down, then the scorer races off to celebrate.
 */
export function goalAt(time: number, side: 'home' | 'away', carry: number): Frame {
  const t = Math.min(Math.max(time, 0), 60)
  const d = side === 'home' ? 1 : -1
  const scorer = track([[0, 0.1 * d], [1.0, 0.7 * d], [1.2, 0.72 * d], [2.4, 0.4 * d], [4.2, 0.15 * d]], t)
  const chaser = track([[0, -0.15 * d], [1.0, 0.4 * d], [1.5, 0.5 * d], [4.2, 0.5 * d]], t)
  const celebrating = t > 2.4 ? 0.3 * Math.abs(Math.sin((t - 2.4) * 5)) : 0
  let ballAt: { f: number; lift: number }
  if (t < 1.0) ballAt = { f: scorer + d * carry, lift: 0.06 * Math.abs(Math.sin(t * 9)) }
  else if (t < 1.35) ballAt = flight(t, 1.0, 1.35, 0.7 * d + d * carry, 0, (GOAL_LINE + 0.07) * d, 0.5, 0.3)
  else ballAt = flight(t, 1.35, 1.8, (GOAL_LINE + 0.07) * d, 0.5, (GOAL_LINE + 0.1) * d, 0, 0.05)
  const beaten = { f: KEEPER * d - (t > 1.0 ? 0.1 * d * Math.min(1, (t - 1.0) / 0.4) : 0), lift: bump(t, 1.0, 1.5, 0.5), tilt: t > 1.25 ? -80 * d * Math.min(1, (t - 1.25) / 0.3) : 0 }
  const happyKeeper = { f: -KEEPER * d, lift: t > 1.5 ? 0.25 * Math.abs(Math.sin((t - 1.5) * 6)) : 0, tilt: 0 }
  const mine = { f: scorer, lift: (t < 1.3 ? bump(t, 0.95, 1.2, 0.14) : 0) + celebrating, tilt: 0 }
  const theirs = { f: chaser, lift: 0, tilt: 0 }

  return side === 'home'
    ? { home: mine, away: theirs, homeKeeper: happyKeeper, awayKeeper: beaten, ball: ballAt }
    : { home: theirs, away: mine, homeKeeper: beaten, awayKeeper: happyKeeper, ball: ballAt }
}

// ---- The scene ------------------------------------------------------------

export type PitchScene = {
  match: Match
  /** A goal being celebrated: who scored and when (ms). */
  goal?: { side: 'home' | 'away'; at: number; id: string }
}

const minuteLabel = (m: Match) => (m.state === 'in' ? m.status : m.state === 'post' ? 'FT' : '')
const scoreLabel = (m: Match) => `${m.home.abbr} ${m.home.score ?? 0}–${m.away.score ?? 0} ${m.away.abbr}`

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)

  return h >>> 0
}

function rng(seed: string) {
  let x = hash(seed) || 1

  return () => {
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5

    return ((x >>> 0) % 10_000) / 10_000
  }
}

// ---- Desktop: one self-animating SVG ---------------------------------------

export const PITCH_H = 104
const STAND_H = 30
const BOARD_H = 8
const GROUND = 96
const PX = 3
const PY = 4
const SW = SPRITE_W * PX
const SH = SPRITE_H * PY
const GOAL_H = 40

/** Horizontal runs of one colour per row, so a sprite is a dozen rects, not seventy. */
function spriteRects(kit: Kit, isKeeper: boolean, leg: 0 | 1): string {
  const px = spritePixels(kit, isKeeper, leg)
  const rows = new Map<number, [number, string][]>()
  for (const [x, y, c] of px) rows.set(y, [...(rows.get(y) ?? []), [x, c]])
  let out = ''
  for (const [y, cells] of rows) {
    cells.sort((p, q) => p[0] - q[0])
    let i = 0
    while (i < cells.length) {
      let j = i
      while (j + 1 < cells.length && cells[j + 1]![0] === cells[j]![0] + 1 && cells[j + 1]![1] === cells[i]![1]) j++
      out += `<rect x="${(cells[i]![0] * PX).toFixed(1)}" y="${(y * PY).toFixed(1)}" width="${((j - i + 1) * PX + 0.05).toFixed(2)}" height="${(PY + 0.05).toFixed(2)}" fill="${cells[i]![1]}"/>`
      i = j + 1
    }
  }

  return out
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toString()

/** The pitch for `scene`, `w` pixels wide; it animates on its own. */
export function pitchSvg(scene: PitchScene, w: number): string {
  const { match: m } = scene
  const c = w / 2
  const span = Math.max(60, w / 2 - 70)
  const toX = (f: number) => c + f * span
  const toY = (lift: number) => GROUND - lift * SH
  const carry = (SW * 0.42) / span
  const k = kits(m.home, m.away)
  const goal = scene.goal
  const seconds = goal ? GOAL_SECONDS : PLAY_SECONDS
  const at = (t: number) => (goal ? goalAt(t, goal.side, carry) : playAt(t, carry, (GOAL_H - 3) / SH))
  // Sampled keyframes, every 0.1 s.
  const steps = Math.round(seconds * 10)
  const frames = Array.from({ length: steps + 1 }, (_, i) => at((i / steps) * seconds))
  const repeat = goal ? 'fill="freeze"' : 'repeatCount="indefinite"'
  const moveValues = (pick: (f: Frame) => { f: number; lift: number }, dx: number, dy: number) =>
    frames.map(fr => `${fmt(toX(pick(fr).f) + dx)},${fmt(toY(pick(fr).lift) + dy)}`).join(';')

  const mascot = (kit: Kit, isKeeper: boolean, pick: (f: Frame) => Pose) => {
    const tilts = frames.map(fr => fmt(pick(fr).tilt))
    const tilted = tilts.some(v => v !== '0')
    // A mascot that falls turns about its middle and rises by however much
    // wider than tall it has become, so it lies on the grass, not in it.
    const lying = (fr: Frame) => {
      const p = pick(fr)
      const turn = Math.abs(Math.sin((p.tilt * Math.PI) / 180))

      return { f: p.f, lift: p.lift + (turn * (SW - SH)) / 2 / SH }
    }

    return `<g>
      <animateTransform attributeName="transform" type="translate" values="${moveValues(tilted ? lying : pick, -SW / 2, -SH)}" dur="${seconds}s" ${repeat}/>
      <g>${tilted ? `<animateTransform attributeName="transform" type="rotate" values="${tilts.map(v => `${v} ${fmt(SW / 2)} ${fmt(SH / 2)}`).join(';')}" dur="${seconds}s" ${repeat}/>` : ''}
        <g>${spriteRects(kit, isKeeper, 0)}<animate attributeName="opacity" values="1;0" dur=".32s" calcMode="discrete" repeatCount="indefinite"/></g>
        <g opacity="0">${spriteRects(kit, isKeeper, 1)}<animate attributeName="opacity" values="0;1" dur=".32s" calcMode="discrete" repeatCount="indefinite"/></g>
      </g>
    </g>`
  }
  const shadow = (pick: (f: Frame) => { f: number; lift: number }, rx: number) =>
    `<ellipse rx="${rx}" ry="2.2" fill="#000" opacity=".28"><animateTransform attributeName="transform" type="translate" values="${frames.map(fr => `${fmt(toX(pick(fr).f))},${GROUND + 1}`).join(';')}" dur="${seconds}s" ${repeat}/></ellipse>`

  // Grass, stripes and markings.
  const stripes = Array.from({ length: Math.ceil(w / 36) }, (_, i) =>
    `<rect x="${i * 36}" y="${STAND_H + BOARD_H}" width="36" height="${PITCH_H - STAND_H - BOARD_H}" fill="${i % 2 ? '#2b8a43' : '#2f9449'}"/>`).join('')
  // Goals, side on: post, crossbar and a hatched net behind the goal line.
  const goalFrame = (dir: 1 | -1) => {
    const x = toX(GOAL_LINE * dir)
    const back = x + 20 * dir
    const top = GROUND - GOAL_H
    const hatch = Array.from({ length: 6 }, (_, i) => {
      const y = top + 4 + i * 5

      return `<line x1="${fmt(x)}" y1="${y}" x2="${fmt(back)}" y2="${y + 3}"/>`
    }).join('') + Array.from({ length: 4 }, (_, i) => {
      const xx = x + (i + 1) * 4 * dir

      return `<line x1="${fmt(xx)}" y1="${top + 1 + i}" x2="${fmt(xx)}" y2="${GROUND}"/>`
    }).join('')
    const bulge = goal && ((goal.side === 'home' && dir === 1) || (goal.side === 'away' && dir === -1))
      ? `<animateTransform attributeName="transform" type="translate" values="0,0;${4 * dir},1;0,0" begin="1.3s" dur=".5s" fill="freeze"/>`
      : ''

    return `<g stroke="#ffffff" stroke-opacity=".45" stroke-width=".8">${bulge}${hatch}<line x1="${fmt(back)}" y1="${top + 6}" x2="${fmt(back)}" y2="${GROUND}"/></g>
      <rect x="${fmt(x - 1.5)}" y="${top}" width="3" height="${GOAL_H}" fill="#f2f2f2"/>
      <rect x="${fmt(Math.min(x, back) - (dir === 1 ? 0 : 0))}" y="${top}" width="${Math.abs(back - x) + 1.5}" height="3" fill="#f2f2f2"/>`
  }

  // The crowd: little heads in both teams' colours, bouncing on a goal.
  const r = rng(m.id)
  const crowd = Array.from({ length: Math.floor(w / 7) * 3 }, (_, i) => {
    const col = i % Math.floor(w / 7)
    const row = Math.floor(i / Math.floor(w / 7))
    const x = col * 7 + (row % 2) * 3.5 + 1
    const y = 7 + row * 7
    const fan = r()
    const colour = fan < 0.38 ? k.home.shirt : fan < 0.76 ? k.away.shirt : fan < 0.9 ? '#e8d5c4' : '#9aa0ab'

    return `<rect x="${fmt(x)}" y="${y}" width="4" height="4" rx="1" fill="${colour}" opacity=".85"/>`
  }).join('')
  const crowdBounce = goal
    ? `<animateTransform attributeName="transform" type="translate" values="0,0;0,-2.5;0,0" dur=".35s" begin="1.4s" repeatCount="indefinite"/>`
    : `<animateTransform attributeName="transform" type="translate" values="0,0;0,-.8;0,0" dur="1.6s" repeatCount="indefinite"/>`

  // The LED boards: the score, scrolling.
  const tickerText = `⚽ ${scoreLabel(m)} ${minuteLabel(m)}   ·   CLAUDE CODE LIVE SCORES   ·   `
  const tickerW = measure(tickerText, 7, 700) + 8
  const copies = Math.ceil(w / tickerW) + 1
  const ticker = `<g><animateTransform attributeName="transform" type="translate" from="0,0" to="${fmt(-tickerW)},0" dur="${fmt(tickerW / 22)}s" repeatCount="indefinite"/>
    ${Array.from({ length: copies }, (_, i) => `<text x="${fmt(i * tickerW)}" y="${STAND_H + BOARD_H / 2 + 0.5}" dominant-baseline="central" font-size="7" font-weight="700" fill="#ffd400" letter-spacing=".5">${esc(tickerText)}</text>`).join('')}</g>`

  // The scoreboard, top left.
  const homeAbbr = esc(m.home.abbr)
  const awayAbbr = esc(m.away.abbr)
  const score = `${m.home.score ?? 0} – ${m.away.score ?? 0}`
  const minute = minuteLabel(m)
  const boardW = 16 + 10 + measure(homeAbbr, 11, 700) + 10 + measure(score, 12, 800) + 10 + measure(awayAbbr, 11, 700) + 10 + 10 + (minute ? measure(minute, 10, 700) + 10 : 0)
  let x = 8
  const parts: string[] = []
  if (minute) {
    parts.push(`<text x="${fmt(x + 8)}" y="12.5" dominant-baseline="central" font-size="10" font-weight="700" fill="#ff3b3b">${esc(minute)}</text>`)
    x += measure(minute, 10, 700) + 14
  }
  parts.push(`<rect x="${fmt(x + 4)}" y="8" width="6" height="9" rx="1" fill="${k.home.shirt}" stroke="#fff" stroke-opacity=".5" stroke-width=".6"/>`)
  x += 14
  parts.push(`<text x="${fmt(x)}" y="12.5" dominant-baseline="central" font-size="11" font-weight="700" fill="#fff">${homeAbbr}</text>`)
  x += measure(homeAbbr, 11, 700) + 8
  parts.push(`<text x="${fmt(x)}" y="12.5" dominant-baseline="central" font-size="12" font-weight="800" fill="#fff">${score}</text>`)
  x += measure(score, 12, 800) + 8
  parts.push(`<text x="${fmt(x)}" y="12.5" dominant-baseline="central" font-size="11" font-weight="700" fill="#fff">${awayAbbr}</text>`)
  x += measure(awayAbbr, 11, 700) + 4
  parts.push(`<rect x="${fmt(x)}" y="8" width="6" height="9" rx="1" fill="${k.away.shirt}" stroke="#fff" stroke-opacity=".5" stroke-width=".6"/>`)
  const scoreboard = `<rect x="4" y="3" width="${fmt(Math.max(boardW, x + 14))}" height="19" rx="5" fill="#0b0c0f" opacity=".92"/>${parts.join('')}`

  // A goal: the word, in the scorer's colours, and confetti from the net.
  let party = ''
  if (goal) {
    const s = goal.side === 'home' ? k.home : k.away
    const word = 'GOAL!'
    const net = toX((GOAL_LINE + 0.1) * (goal.side === 'home' ? 1 : -1))
    const rc = rng(goal.id)
    const confetti = Array.from({ length: 22 }, (_, i) => {
      const dx = (rc() - 0.5) * 160
      const up = 20 + rc() * 40
      const dur = (1.2 + rc() * 1.2).toFixed(2)
      const col = [s.shirt, s.shorts, '#ffd400', '#ffffff', '#16c26b'][i % 5]

      return `<g transform="translate(${fmt(net)} ${GROUND - 14})"><rect x="-1.5" y="-1" width="${(2 + rc() * 3).toFixed(1)}" height="2.4" fill="${col}" opacity="0">
        <animate attributeName="opacity" values="1;1;0" keyTimes="0;.75;1" begin="1.35s" dur="${dur}s" fill="freeze"/>
        <animateMotion begin="1.35s" dur="${dur}s" fill="freeze" path="M0,0 Q${fmt(dx / 2)},${fmt(-up)} ${fmt(dx)},${fmt(16 + rc() * 10)}"/>
      </rect></g>`
    }).join('')
    party = `${confetti}
      <g transform="translate(${fmt(c)} ${STAND_H + 22})"><g opacity="0">
        <set attributeName="opacity" to="1" begin="1.4s"/>
        <animateTransform attributeName="transform" type="scale" values="0;1.35;.9;1.1;1" keyTimes="0;.3;.55;.8;1" begin="1.4s" dur=".7s" fill="freeze"/>
        <text x="0" y="0" text-anchor="middle" dominant-baseline="central" font-size="26" font-style="italic" font-weight="900" fill="#ffffff" stroke="${s.shirt}" stroke-width="5" paint-order="stroke" letter-spacing="1">${word}</text>
      </g></g>`
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w)}" height="${PITCH_H}" viewBox="0 0 ${Math.round(w)} ${PITCH_H}" font-family="${FONT}">
  <clipPath id="pitch"><rect width="${Math.round(w)}" height="${PITCH_H}" rx="8"/></clipPath>
  <g clip-path="url(#pitch)">
  <rect width="${Math.round(w)}" height="${STAND_H}" fill="#15171c"/>
  <g>${crowdBounce}${crowd}</g>
  <rect y="${STAND_H}" width="${Math.round(w)}" height="${BOARD_H}" fill="#0b0c0f"/>
  ${ticker}
  ${stripes}
  <ellipse cx="${fmt(c)}" cy="${GROUND - 3}" rx="${fmt(Math.min(70, span * 0.35))}" ry="5" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1"/>
  <rect x="${fmt(c - 0.5)}" y="${STAND_H + BOARD_H}" width="1" height="${PITCH_H - STAND_H - BOARD_H}" fill="#fff" opacity=".22"/>
  ${goalFrame(-1)}
  ${goalFrame(1)}
  ${shadow(fr => fr.homeKeeper, 13)}${shadow(fr => fr.awayKeeper, 13)}${shadow(fr => fr.home, 13)}${shadow(fr => fr.away, 13)}${shadow(fr => ({ f: fr.ball.f, lift: 0 }), 4)}
  ${mascot(k.home, true, fr => fr.homeKeeper)}
  ${mascot(k.away, true, fr => fr.awayKeeper)}
  ${mascot(k.away, false, fr => fr.away)}
  ${mascot(k.home, false, fr => fr.home)}
  <g><animateTransform attributeName="transform" type="translate" values="${moveValues(fr => fr.ball, 0, -4.5)}" dur="${seconds}s" ${repeat}/>
    <g><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur=".7s" repeatCount="indefinite"/>${ball(4.5)}</g></g>
  ${party}
  ${scoreboard}
  </g>
</svg>`
}

// ---- Terminal: block pixels, a frame at a time ------------------------------

// A cell is 2×2 pixels drawn as a quadrant character: bit 1 top left, 2 top
// right, 4 bottom left, 8 bottom right.
const QUADRANTS = ' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█'
export const PITCH_ROWS = 6
const DEFAULT = 0x01000000

const hexToInt = (hex: string) => Number.parseInt(hex.slice(1), 16)

/** One frame of the pitch for the terminal: `columns` cells across, PITCH_ROWS down. */
export function pitchCells(scene: PitchScene, columns: number, nowMs: number): Uint32Array {
  const { match: m } = scene
  const pw = columns * 2
  const ph = PITCH_ROWS * 2
  const ground = ph - 1
  const px = new Int32Array(pw * ph).fill(-1)
  const set = (x: number, y: number, colour: number) => {
    const xi = Math.round(x)
    const yi = Math.round(y)
    if (xi >= 0 && xi < pw && yi >= 0 && yi < ph) px[yi * pw + xi] = colour
  }
  const c = pw / 2
  const span = Math.max(16, pw / 2 - 26)
  const toX = (f: number) => c + f * span
  const carry = (SPRITE_W * 0.42) / span
  const k = kits(m.home, m.away)
  const goal = scene.goal
  const t = goal ? (nowMs - goal.at) / 1000 : nowMs / 1000
  const fr = goal ? goalAt(t, goal.side, carry) : playAt(t, carry, 1.4)
  // Heights squeezed into eight pixels of pitch.
  const lift = (l: number) => Math.round(l * 4)

  // Grass in stripes, the stand above it.
  for (let y = 0; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      if (y < 2) px[y * pw + x] = 0x15171c
      else if (y < 4) px[y * pw + x] = 0x0b0c0f
      else px[y * pw + x] = Math.floor(x / 8) % 2 ? 0x2b8a43 : 0x2f9449
    }
  }
  const r = rng(m.id)
  const bounce = goal && t > 1.4 ? Math.floor(nowMs / 180) % 2 : 0
  for (let x = 0; x < pw; x += 2) {
    const fan = r()
    const colour = fan < 0.4 ? hexToInt(k.home.shirt) : fan < 0.8 ? hexToInt(k.away.shirt) : 0xe8d5c4
    set(x, 1 - bounce, colour)
  }
  // Goals: posts and crossbars.
  for (const dir of [-1, 1] as const) {
    const x = toX(GOAL_LINE * dir)
    for (let y = ground - 6; y <= ground; y++) set(x, y, 0xf2f2f2)
    for (let i = 0; i <= 5; i++) set(x + i * dir, ground - 6, 0xf2f2f2)
    for (let y = ground - 5; y <= ground; y += 2) for (let i = 1; i <= 5; i += 2) set(x + i * dir, y, 0x9fb7a6)
  }
  // The mascots, a pixel per sprite pixel.
  const leg = (Math.floor(nowMs / 160) % 2) as 0 | 1
  const draw = (kit: Kit, isKeeper: boolean, pose: Pose) => {
    const left = Math.round(toX(pose.f) - SPRITE_W / 2)
    const top = ground + 1 - SPRITE_H - lift(pose.lift)
    // Too few pixels to turn a mascot on its side: a beaten keeper slumps
    // onto the grass instead, legs folded away.
    const isDown = Math.abs(pose.tilt) > 45
    for (const [x, y, colour] of spritePixels(kit, isKeeper, leg)) {
      if (!isDown) set(left + x, top + y, hexToInt(colour))
      else if (y < BODY.length) set(left + x + Math.sign(pose.tilt) * 2, ground + 1 - BODY.length + y, hexToInt(colour))
    }
  }
  draw(k.home, true, fr.homeKeeper)
  draw(k.away, true, fr.awayKeeper)
  draw(k.away, false, fr.away)
  draw(k.home, false, fr.home)
  const bx = toX(fr.ball.f)
  const by = ground - 1 - lift(fr.ball.lift)
  set(bx, by, 0xffffff)
  set(bx + 1, by, 0xdddddd)

  // Pack 2×2 pixels into quadrant characters: the two commonest colours of
  // each cell become its foreground and background.
  const cells = new Uint32Array(columns * PITCH_ROWS * 3)
  for (let cy = 0; cy < PITCH_ROWS; cy++) {
    for (let cx = 0; cx < columns; cx++) {
      const quad = [px[cy * 2 * pw + cx * 2]!, px[cy * 2 * pw + cx * 2 + 1]!, px[(cy * 2 + 1) * pw + cx * 2]!, px[(cy * 2 + 1) * pw + cx * 2 + 1]!]
      const counts = new Map<number, number>()
      for (const q of quad) counts.set(q, (counts.get(q) ?? 0) + 1)
      const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0])
      const bg = ranked[0]!
      const fg = ranked[1] ?? bg
      let mask = 0
      quad.forEach((q, i) => {
        if (q === fg && fg !== bg) mask |= 1 << i
      })
      const at = (cy * columns + cx) * 3
      cells[at] = QUADRANTS.codePointAt(mask)!
      cells[at + 1] = fg < 0 ? DEFAULT : fg
      cells[at + 2] = bg < 0 ? DEFAULT : bg
    }
  }
  // The boards row carries the score as real text.
  const text = ` ${minuteLabel(m) ? `${minuteLabel(m)} ` : ''}${scoreLabel(m)}${goal && t > 1.4 ? '  GOAL!' : ''} `
  const start = Math.max(0, Math.floor((columns - text.length) / 2))
  ;[...text].forEach((ch, i) => {
    const cx = start + i
    if (cx >= columns) return
    const at = (1 * columns + cx) * 3
    const code = ch.codePointAt(0)!
    cells[at] = code === 0x2013 ? 0x2d : code
    cells[at + 1] = goal && t > 1.4 && i > text.length - 8 ? 0xffd400 : 0xffffff
    cells[at + 2] = 0x0b0c0f
  })

  return cells
}

export const toBase64 = (cells: Uint32Array) => {
  const bytes = new Uint8Array(cells.buffer)
  const anyBytes = bytes as unknown as { toBase64?: () => string }
  if (typeof anyBytes.toBase64 === 'function') return anyBytes.toBase64()
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)

  return btoa(s)
}
