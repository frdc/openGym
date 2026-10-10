import { t, useLang } from '../lib/i18n.js'
import { heartRateEndReading } from '../lib/heart-rate.js'

const seconds = ms => Math.round(ms / 100) / 10
const number = n => Math.round(n * 10) / 10

export default function HeartRateSummary({ heartRate, label }) {
  useLang()
  if (!heartRate) return null
  const { status, effortEndMs, recoveryEndMs, effort, recovery } = heartRate
  const points = (heartRate.points || []).filter(p => Array.isArray(p) && Number.isFinite(p[0]) && p[0] >= 0 && Number.isFinite(p[1]) && p[1] > 0)
  const boundary = Number.isFinite(effortEndMs) && effortEndMs >= 0 ? effortEndMs : null
  const endReading = heartRateEndReading(heartRate)
  const end = Math.max(1, boundary || 0, recoveryEndMs || 0, ...points.map(p => p[0]))
  const low = points.length ? Math.min(...points.map(p => p[1])) - 5 : 0
  const high = points.length ? Math.max(...points.map(p => p[1])) + 5 : 1
  const x = ms => 34 + ms / end * 270
  const y = bpm => 85 - (bpm - low) / (high - low) * 65
  const phase = (name, summary, duration) => <div>
    <strong>{t(name)}</strong>{duration != null && <> · {t('{0} s', seconds(duration))}</>}
    <div>{summary?.count > 0 ? t('Mean {0} bpm · Peak {1} bpm', number(summary.mean), number(summary.peak)) : t('No heart rate readings')}</div>
  </div>
  return <section className="small" style={{ margin: '8px 0', padding: 10, border: '1px solid var(--sep)', borderRadius: 8 }} aria-label={t('Set heart rate')}>
    <strong>{t('Set heart rate')}{label && <> · {label}</>}</strong>
    {status === 'pending' && <div className="dim">{t('Heart rate pending')}</div>}
    {status === 'partial' && <div className="dim">{t('Partial heart rate readings')}</div>}
    {!points.length && <div className="dim">{t('No heart rate readings')}</div>}
    {!!points.length && <svg viewBox="0 0 320 112" role="img" aria-label={t('Heart rate over time')} style={{ display: 'block', width: '100%', maxWidth: 480, color: 'var(--text)' }}>
      <title>{t('Heart rate over time')}</title>
      <text x="2" y="14" fill="currentColor" fontSize="10">bpm</text>
      <text x="2" y="29" fill="currentColor" fontSize="10">{number(high)}</text>
      <text x="2" y="85" fill="currentColor" fontSize="10">{number(low)}</text>
      <path d="M34 20V90H304" fill="none" stroke="currentColor" opacity=".3" />
      {boundary != null && <g data-effort-end-ms={boundary}>
        <line x1={x(boundary)} x2={x(boundary)} y1="20" y2="90" stroke="currentColor" strokeDasharray="3 3" />
        <text x={x(boundary)} y="14" textAnchor={x(boundary) > 170 ? 'end' : 'start'} fontSize="10" fill="currentColor">{t('Set ended')}</text>
      </g>}
      {/* Individual sensor readings leave gaps visible without inventing interpolated data. */}
      {points.map(([ms, bpm], i) => <circle key={i} cx={x(ms)} cy={y(bpm)} r="2.4" fill="currentColor"><title>{t('{0} s', seconds(ms))} · {number(bpm)} bpm · {t(ms <= (boundary ?? end) ? 'Heart rate effort' : 'Heart rate recovery')}</title></circle>)}
      <text x="34" y="106" fontSize="10" fill="currentColor">{t('{0} s', 0)}</text>
      <text x="304" y="106" fontSize="10" textAnchor="end" fill="currentColor">{t('{0} s', seconds(end))}</text>
    </svg>}
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px' }}>
      {phase('Heart rate effort', effort, boundary)}
      {boundary != null && phase('Heart rate recovery', recovery, Number.isFinite(recoveryEndMs) ? Math.max(0, recoveryEndMs - boundary) : null)}
    </div>
    {endReading && <div>{t('Set ended')} · {t('{0} s', seconds(endReading[0]))} · {number(endReading[1])} bpm</div>}
    {boundary != null && (heartRate.milestones || []).map(m => <div key={m.seconds}>
      {t('{0} s: {1} bpm ({2} bpm)', seconds(m.atMs - boundary), number(m.bpm), m.delta == null ? '–' : (m.delta > 0 ? '−' : '+') + Math.abs(number(m.delta)))}
    </div>)}
  </section>
}

export function SetHeartRateSummaries({ set, label }) {
  return <>
    {set.done && <HeartRateSummary heartRate={set.heartRate} label={label} />}
    {['L', 'R'].map(side => set.sides?.[side]?.done && <HeartRateSummary key={side} heartRate={set.sides[side].heartRate} label={[label, t(side === 'L' ? 'Left' : 'Right')].filter(Boolean).join(' · ')} />)}
  </>
}
