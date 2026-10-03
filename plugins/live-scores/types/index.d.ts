export type MatchState = 'pre' | 'in' | 'post'

export type Side = {
  id: string
  name: string
  abbr: string
  color: string
  /** The second kit colour (shorts, or the away shirt on a clash). */
  alt: string
  logo: string
  score: number | null
  isWinner: boolean
  reds: number
}

export type Incident = {
  kind: 'goal' | 'red'
  side: 'home' | 'away'
  minute: string
  player: string
  isPenalty: boolean
  isOwnGoal: boolean
}

export type Match = {
  id: string
  league: string
  start: number
  state: MatchState
  status: string
  home: Side
  away: Side
  incidents: Incident[]
  isDemo?: boolean
}

export type Board = { matches: Match[]; fetchedAt: number; error: string }

/** A moment worth animating: a goal, a red card or a goal VAR took back. */
export type Celebration = {
  id: string
  matchId: string
  kind: 'goal' | 'red' | 'var'
  side: 'home' | 'away'
  at: number
  player: string
  minute: string
}

export type Filter = 'all' | 'live'

declare module 'claude-code' {
  interface PluginState {
    'live-scores': {
      board: Board
      celebrations: Celebration[]
      tick: number
      filter: Filter
      logoRev: number
      /** Whether the mascot pitch shows above the prompt. */
      pitch: boolean
      /** Advances the terminal pitch's frames; the desktop one animates itself. */
      pitchTick: number
      /** Which live match the pitch features, when no goal picks one. */
      pitchTurn: number
    }
  }
}
