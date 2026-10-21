import { useEffect, useState } from 'react'
import { Button } from './ui.jsx'
import { isAndroid } from '../lib/mobile.js'
import { openWearApp, syncWearApp } from '../lib/wear-bridge.js'
import { t } from '../lib/i18n.js'

export default function WearWorkoutActions() {
  const [available, setAvailable] = useState(false)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => { let live = true; void isAndroid().then(value => { if (live) setAvailable(value) }); return () => { live = false } }, [])
  if (!available) return null
  const open = async () => {
    setBusy('open'); setMessage('')
    try { await openWearApp(); setMessage(t('Request sent to watch')) }
    catch { setMessage(t('Watch unavailable')) }
    finally { setBusy('') }
  }
  const sync = async () => {
    setBusy('sync'); setMessage('')
    try {
      const result = await syncWearApp()
      setMessage(result.heartPending ? t('Workout updated. Heart rate data is still pending on the watch.') : t('Workout synced with watch'))
    } catch (error) {
      setMessage(error.code === 'sync-conflict' ? t('Sync conflict. Watch data was kept.') : t('Watch did not confirm sync. Pending data was kept.'))
    } finally { setBusy('') }
  }
  return <div className="mb12">
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <Button size="sm" variant="ghost" disabled={!!busy} onClick={open}>{t('Open on watch')}</Button>
      <Button size="sm" variant="ghost" disabled={!!busy} onClick={sync}>{busy === 'sync' ? t('Syncing with watch…') : t('Sync with watch')}</Button>
    </div>
    <div role="status" aria-live="polite" className="muted small">{message}</div>
  </div>
}
