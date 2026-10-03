import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane',
  requestId: 'live-scores',
  props: { title: '⚽ Live Scores', isFocused: false, bodyColumns: 70, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const

test('the demo match draws and celebrates on every surface', async ($, on) => {
  const clock = mock.clock(on, { now: Date.now() })
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as any)
  on('http.fetch', () => ({ value: { status: 503, ok: false, headers: {}, text: '' } }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as any)
  await $.command.run({ command: 'scores', args: 'demo' } as any)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'live-scores', surface, ...PANE } as any)
    expect(await ui.find({ key: 'live' })).toBeDefined()
    if (surface === 'terminal') {
      expect(await ui.find({ type: 'Text', text: /Arsenal/ })).toBeDefined()
    } else {
      expect(await ui.find({ type: 'Svg' } as any)).toBeDefined()
    }
    await clock.advance(1500)
    await ui.redraw()
    if (surface === 'terminal') expect(await ui.find({ type: 'Text', text: /B\. Saka/ })).toBeDefined()
    await ui.press({ key: 'live' })
    await ui.unmount()
  }
})

const BAND = {
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 20 } },
} as const

test('the mascot pitch plays the live match above the prompt', async ($, on) => {
  // The engine's own band beneath ours: nothing of its own to draw.
  on('ui.render', { component: 'AbovePrompt' }, () => ({ type: 'engine', ref: 0 }) as any)
  const clock = mock.clock(on, { now: Date.now() })
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }) as any)
  on('http.fetch', () => ({ value: { status: 503, ok: false, headers: {}, text: '' } }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }) as any)
  await $.command.run({ command: 'scores', args: 'demo' } as any)
  const terminal = await $.ui.mount({ plugin: 'live-scores', surface: 'terminal', ...BAND } as any)
  expect(await terminal.find({ type: 'Raster' } as any)).toBeDefined()
  await clock.advance(1500)
  await terminal.redraw()
  expect(await terminal.find({ type: 'Raster' } as any)).toBeDefined()
  await terminal.unmount()
  const desktop = await $.ui.mount({ plugin: 'live-scores', surface: 'desktop', ...BAND } as any)
  expect(await desktop.find({ type: 'Svg' } as any)).toBeDefined()
  await desktop.unmount()
  await $.command.run({ command: 'scores', args: 'pitch off' } as any)
  const off = await $.ui.mount({ plugin: 'live-scores', surface: 'desktop', ...BAND } as any)
  expect(await off.find({ type: 'Svg' } as any)).toBeUndefined()
  await off.unmount()
})
