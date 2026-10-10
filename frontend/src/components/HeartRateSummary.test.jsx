import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import HeartRateSummary, { SetHeartRateSummaries } from './HeartRateSummary.jsx'

vi.mock('../lib/i18n.js', async () => ({ ...await import('../lib/i18n-core.js'), useLang: () => {} }))

const render = heartRate => renderToStaticMarkup(<HeartRateSummary heartRate={heartRate} />)
const measurement = {
  v: 1, status: 'complete', effortEndMs: 10000, recoveryEndMs: 70000,
  points: [[0, 120], [10000, 150], [42000, 130], [70000, 110]],
  effort: { count: 2, mean: 135, peak: 150 }, recovery: { count: 2, mean: 120, peak: 130 },
  milestones: [{ seconds: 30, atMs: 42000, bpm: 130, delta: 20 }],
}

describe('HeartRateSummary', () => {
  it('keeps legacy sets absent and unavailable readings free of invented zero bpm', () => {
    expect(render(undefined)).toBe('')
    const html = render({ status: 'empty', points: [], effort: null, recovery: null })
    expect(html).toContain('No heart rate readings')
    expect(html).not.toContain('0 bpm')
  })
  it('separates phase summaries and marks the real effort boundary on the chart', () => {
    const html = render(measurement)
    expect(html).toContain('Heart rate effort')
    expect(html).toContain('Mean 135 bpm · Peak 150 bpm')
    expect(html).toContain('Mean 120 bpm · Peak 130 bpm')
    expect(html).toContain('data-effort-end-ms="10000"')
    expect(html).toContain('Set ended')
    expect(html).toContain('10 s')
    expect(html).toContain('60 s')
  })
  it('shows actual recovery landmark time without fabricating absent landmarks', () => {
    const html = render(measurement)
    expect(html).toContain('32 s: 130 bpm (−20 bpm)')
    expect(html).not.toContain('30 s:')
    expect(html).not.toContain('120 s:')
  })
  it('keeps measured time and means precise, and omits an unavailable end reading', () => {
    const html = render({ ...measurement, points: [[0, 120], [42000, 130]],
      effort: { count: 2, mean: 135.4, peak: 150 },
      milestones: [{ seconds: 30, atMs: 42100, bpm: 130, delta: 20 }],
    })
    expect(html).toContain('Mean 135.4 bpm')
    expect(html).toContain('32.1 s: 130 bpm (−20 bpm)')
    expect(html).not.toContain('Set ended ·')
  })
  it('identifies partial and pending capture without assuming an end time', () => {
    expect(render({ ...measurement, status: 'partial' })).toContain('Partial heart rate readings')
    const html = render({ status: 'pending', points: [], effortEndMs: null })
    expect(html).toContain('Heart rate pending')
    expect(html).not.toContain('Set ended')
  })
  it('renders completed side measurements independently of aggregate completion', () => {
    const html = renderToStaticMarkup(<SetHeartRateSummaries set={{ done: false, sides: {
      L: { done: true, heartRate: measurement }, R: { done: false, heartRate: measurement },
    } }} />)
    expect(html).toContain('Left')
    expect(html).not.toContain('Right')
    expect((html.match(/data-effort-end-ms/g) || []).length).toBe(1)
  })
})
