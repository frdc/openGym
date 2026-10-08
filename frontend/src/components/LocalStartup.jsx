import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'

// No domain content is rendered until local hydration succeeds, including after Auth changes.
export default function LocalStartup() {
  const sync = useStore(s => s.sync)
  const context = useStore.getState().getContext()
  const mounted = useRef(true)
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { pending.current = false; setBusy(false) }, [context.ownerKey, context.epoch])
  const retry = async () => {
    if (pending.current) return
    const captured = useStore.getState().getContext()
    const current = () => { const now = useStore.getState().getContext(); return mounted.current && now.ownerKey === captured.ownerKey && now.epoch === captured.epoch }
    pending.current = true; setBusy(true)
    try { await useStore.getState().retryLocal() }
    catch { /* The store publishes the safe local error status; never render storage diagnostics. */ }
    finally { if (current()) { pending.current = false; setBusy(false) } }
  }
  return <div id="app">
    {sync.local === 'error' ? <div style={{ padding: '30vh 24px 24px', textAlign: 'center' }}>
      <p role="alert">{t('Changes could not be saved on this device. Keep the app open and try again.')}</p>
      <Button disabled={busy} onClick={retry}>{t('Try again')}</Button>
    </div> : <div style={{ paddingTop: '44vh', display: 'flex', justifyContent: 'center', fontSize: 34, color: 'var(--label-3)' }}><Icon name="dumbbell" /></div>}
  </div>
}
