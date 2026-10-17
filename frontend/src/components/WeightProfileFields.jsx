import { useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { useDurableSave } from '../lib/use-durable-save.js'
import { availableWeightProfiles, normalizeWeightProfile, weightProfileGrid, withWeightProfile, WEIGHT_PROFILE_LIMIT } from '../lib/weight-profiles.js'
import { t } from '../lib/i18n.js'
import { fmtNum, uid } from '../lib/format.js'
import { Button, NumberField, Row, SelectRow, TextField } from './ui.jsx'

const describe = (profile, unit) => {
  const grid = weightProfileGrid({ weightProfile: profile }, unit)
  return `${profile.name} · ${fmtNum(grid.start)} + ${fmtNum(grid.step)} ${unit}`
}
function profileSheet(profile, onSaved) {
  return useUI.getState().openSheet(close => <WeightProfileForm profile={profile} onSaved={onSaved} close={close} />)
}
function WeightProfileForm({ profile, onSaved, close }) {
  const unit = useStore(s => s.S.unit) || 'kg'
  const [draft, setDraft] = useState(() => profile || { id: uid(), name: '', unit, start: 0, step: unit === 'lb' ? 5 : 2.5 })
  const { saving, run } = useDurableSave()
  const valid = normalizeWeightProfile(draft)
  const profiles = useStore(s => s.S.weightProfiles)
  const full = !profile && availableWeightProfiles({ weightProfiles: profiles }).length >= WEIGHT_PROFILE_LIMIT
  const save = () => {
    if (!valid || full) return
    void run(() => useStore.getState().update(S => {
      S.weightProfiles ||= {}
      S.weightProfiles[valid.id] = { ...valid, _ts: Date.now() }
    }), () => { close(); onSaved?.(valid) })
  }
  const remove = () => void run(() => useStore.getState().update(S => {
    S.weightProfiles ||= {}
    S.weightProfiles[draft.id] = { deleted: true, _ts: Date.now() }
  }), close)
  const change = (key, value) => setDraft(p => ({ ...p, [key]: value }))
  return <>
    <h3>{t(profile ? 'Edit weight profile' : 'New weight profile')}</h3>
    <TextField aria-label={t('Profile name')} placeholder={t('Profile name')} maxLength={80} value={draft.name} disabled={saving} onChange={e => change('name', e.target.value)} />
    <div className="sect-b"><SelectRow title={t('Weight units')} value={draft.unit} options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]} onChange={value => { if (!saving) change('unit', value) }} /></div>
    <div className="row cfgrow" style={{ marginBottom: 16 }}>
      <div className="stp-w"><span className="stp-l">{t('Initial load ({0})', draft.unit)}</span><div className="stp"><span className="val"><NumberField aria-label={t('Initial load ({0})', draft.unit)} value={draft.start} disabled={saving} onChange={value => change('start', value)} /></span></div></div>
      <div className="stp-w"><span className="stp-l">{t('Load increment ({0})', draft.unit)}</span><div className="stp"><span className="val"><NumberField aria-label={t('Load increment ({0})', draft.unit)} value={draft.step} disabled={saving} onChange={value => change('step', value)} /></span></div></div>
    </div>
    {(!valid || full) && <div className="small dim" role="alert" style={{ marginBottom: 12 }}>{t(full ? 'Profile limit reached.' : 'Enter a name and a positive load increment.')}</div>}
    <Button variant="primary" onClick={save} disabled={!valid || full || saving}>{t('Save')}</Button>
    {profile && <Button variant="danger" onClick={remove} disabled={saving} style={{ marginTop: 8 }}>{t('Delete weight profile')}</Button>}
    <Button onClick={close} disabled={saving} style={{ marginTop: 8 }}>{t('Cancel')}</Button>
  </>
}
function WeightProfileManager() {
  const S = useStore(s => s.S)
  const profiles = availableWeightProfiles(S)
  return <>
    <h3>{t('Saved weight profiles')}</h3>
    <div className="sect-b">{profiles.map(profile => <Row key={profile.id} title={profile.name} value={describe(profile, S.unit)} accessory="chevron" onClick={() => profileSheet(profile)} />)}</div>
    <Button variant="primary" onClick={() => profileSheet(null)} disabled={profiles.length >= WEIGHT_PROFILE_LIMIT}>{t('New weight profile')}</Button>
  </>
}
export function WeightProfileFields({ cfg, onChange }) {
  const S = useStore(s => s.S)
  const origin = useRef(useStore.getState().getContext?.())
  const selected = normalizeWeightProfile(cfg?.weightProfile)
  const available = availableWeightProfiles(S)
  const current = () => {
    const context = useStore.getState().getContext?.()
    return !!context && !!origin.current && context.localReady && context.ownerKey === origin.current.ownerKey && context.epoch === origin.current.epoch
  }
  const choose = profile => { if (current()) onChange(withWeightProfile(cfg, profile, useStore.getState().S.unit)) }
  // A deleted/edited saved profile cannot retroactively change this exercise's snapshot.
  const display = selected ? [selected, ...available.filter(p => p.id !== selected.id)] : available
  const options = [{ value: '', label: t('Manual increment') }, ...display.map(p => ({ value: p.id, label: describe(p, S.unit) })), { value: '+', label: t('New weight profile') }]
  return <div className="sect-b" data-weight-profiles>
    <SelectRow title={t('Weight type')} value={selected?.id || ''} options={options} onChange={id => {
      if (!current()) return
      if (id === '+') profileSheet(null, choose)
      else choose(id ? available.find(p => p.id === id) || selected : null)
    }} />
    <Row title={t('Saved weight profiles')} accessory="chevron" onClick={() => { if (current()) useUI.getState().openSheet(() => <WeightProfileManager />) }} />
  </div>
}
