import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { MOBILE, shareExport } from '../lib/mobile.js'
import { menuSheet } from '../sheets.jsx'
import { openPasswordSignIn } from './PasswordAuth.jsx'
import { Section, Row, Button } from './ui.jsx'
const ui = () => useUI.getState()
const toast = message => ui().toast(message)
const context = () => { const s = useStore.getState(); return s.getContext?.() || { ownerKey: s.ownerKey } }
const current = captured => { const now = context(); return now.ownerKey === captured.ownerKey && now.epoch === captured.epoch }
export const hostOf = value => value || ''
export const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false
export function useOnline() {
  const [online, setOnline] = useState(isOnline)
  useEffect(() => {
    const change = () => setOnline(isOnline())
    window.addEventListener('online', change); window.addEventListener('offline', change)
    return () => { window.removeEventListener('online', change); window.removeEventListener('offline', change) }
  }, [])
  return online
}
export function connectionView(sync, { online = isOnline() } = {}) {
  if (!sync) return null
  const view = (tone, icon, line, action = null, banner = line) => ({ tone, icon, line, action, banner })
  if (sync.local === 'error') return view('bad', 'warning', t('Changes could not be saved on this device. Keep the app open and try again.'), 'local')
  if (sync.local === 'saving' || sync.local === 'loading') return view('wait', 'reset', t('Saving on this device…'))
  if (sync.cloud === 'adoption-required') return view('wait', 'reset', t('Waiting for your answer about this device’s workouts'), 'review')
  if (sync.cloud === 'blocked') return view('bad', 'warning', t('Cloud sync needs attention. Your changes are saved on this device.'), 'review')
  if (sync.cloud === 'unconfigured' || sync.guest) return view('quiet', 'lock', t('Your data lives on this device. Sign in to sync.'), 'signin')
  if (sync.cloud === 'auth-required') return view('bad', 'lock', t('Sign in to sync. Your changes are saved on this device.'), 'signin')
  if (!online || sync.cloud === 'waiting') return view('off', 'cloudSlash', t('Offline. Your changes are saved on this device and sync when you’re back online.'), 'retry')
  if (sync.cloud === 'synced') return view('ok', 'cloud', t('All synced'), null, null)
  return view('wait', 'reset', t('Waiting to sync'), 'retry')
}
export const actionLabel = view => ({ retry: t('Try again'), local: t('Try again'), signin: t('Sign in'), review: t('Review pending changes') })[view.action] || null
export const signInAgain = openPasswordSignIn
export async function syncNowWithToast() {
  const captured = context()
  try {
    const store = useStore.getState()
    if (store.sync.local === 'error') { await store.retryLocal(); if (!current(captured)) return }
    if (store.sync.cloud === 'adoption-required') await store.resumeAdoption()
    else if (useStore.getState().localReady) await store.syncNow()
    if (current(captured)) toast(connectionView(useStore.getState().sync).line)
  } catch { if (current(captured)) toast(t('Could not connect')) }
}

export async function leaveServer(_kind, { exportBackup, exportBackupZip, done }) {
  const key = useStore.getState().ownerKey
  try {
    const result = await useStore.getState().signOut()
    if (result.owed && !result.stashed) {
      if (useStore.getState().ownerKey !== key) return
      ui().openSheet(close => <OwedSheet count={result.count} exportBackup={exportBackup} exportBackupZip={exportBackupZip} done={done} close={close} ownerKey={key} />, { kind: 'center', accountAuth: true })
    } else if (!useStore.getState().user) done(result)
  } catch { if (useStore.getState().ownerKey === key) toast(t('Couldn’t keep a copy of the changes on this device. Nothing was removed.')) }
}
export function OwedSheet({ count, exportBackup, exportBackupZip, done, close, ownerKey = useStore.getState().ownerKey }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mounted = useRef(true)
  const captured = useRef({ ...context(), ownerKey }).current
  const mayAct = () => mounted.current && current(captured)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const run = async force => {
    if (busy || !mayAct()) return
    setBusy(true)
    try {
      const result = await useStore.getState().signOut({ force })
      if (!mounted.current) return
      if ((!result.owed || result.stashed) && !useStore.getState().user) { close(); done(result) }
      else if (mayAct()) setError(t('Waiting to sync'))
    } catch { if (mayAct()) setError(t('Couldn’t keep a copy of the changes on this device. Nothing was removed.')) }
    finally { if (mounted.current) setBusy(false) }
  }
  return <div>
    <h3>{t('Changes waiting for cloud sync')}</h3>
    <p>{t('{0} pending changes', count || 0)}</p>
    <p>{t('Signing out keeps a local copy for this account. You can export a backup first.')}</p>
    {error && <p role="alert">{error}</p>}
    <Button disabled={busy} onClick={() => run(false)}>{t('Try again')}</Button>
    <Button disabled={busy} onClick={() => { if (mayAct()) exportBackup() }}>{t('Export backup (JSON)')}</Button>
    {exportBackupZip && <Button disabled={busy} onClick={() => { if (mayAct()) exportBackupZip() }}>{t('Export with photos & videos (.zip)')}</Button>}
    <Button disabled={busy} onClick={() => run(true)}>{t('Sign out anyway')}</Button>
    <Button disabled={busy} onClick={close}>{t('Cancel')}</Button>
  </div>
}
export function ServerSyncSection({ children }) {
  const sync = useStore(s => s.sync)
  const user = useStore(s => s.user)
  const online = useOnline()
  const view = connectionView({ ...sync, guest: !user }, { online })
  return <Section title={t('Account & sync')}>
    {user && <Row icon="person" title={user.displayName || user.email || t('Account')} subtitle={user.email} />}
    <Row icon={view.icon} title={view.line} className="sync-status" />
    {sync.local === 'saved' && <Row icon="check" title={t('Saved on this device')} />}
    {user && <Row icon="reset" title={t('Sync now')} onClick={syncNowWithToast} />}
    {view.action === 'review' && <Row icon="warning" title={t('Review pending changes')} subtitle={sync.cloudError?.path || t('{0} pending changes', sync.pendingCount || 0)} onClick={syncNowWithToast} />}
    <KeptChangesRows />
    {children}
  </Section>
}

export function KeptChangesRows() {
  const copies = useStore(s => s.recoveryCopies)
  const ownerKey = useStore(s => s.ownerKey)
  const ready = useStore(s => s.localReady)
  if (!ready) return null
  const rows = useStore.getState().listRecovery()
  const save = id => {
    if (useStore.getState().ownerKey !== ownerKey) return
    const json = JSON.stringify(useStore.getState().recoveryState(id), null, 2)
    const name = 'opengym-recovery-' + new Date().toISOString().slice(0, 10) + '.json'
    if (MOBILE) { void shareExport(json, name).catch(() => {}); return }
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = name; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }
  const decide = async (id, choice) => {
    if (useStore.getState().ownerKey !== ownerKey) return
    try { await useStore.getState().resolveRecovery(id, choice) }
    catch { if (useStore.getState().ownerKey === ownerKey) toast(t('Could not recover this copy. Export a backup to keep it.')) }
  }
  return rows.map(copy => <Row key={copy.recoveryId} icon="history" title={t('Recoverable local copy')} subtitle={copy.sourceId || t('Saved on this device')} accessory="chevron"
    onClick={() => menuSheet({ title: t('Recoverable local copy'), subtitle: t('Only add this copy if it belongs to you. The original stays on this device.'), items: [
      { icon: 'download', label: t('Save as a backup file'), onClick: () => save(copy.recoveryId) },
      ...(!copy.decision ? [
        { icon: 'plusCircle', label: t('Add my training data'), onClick: () => decide(copy.recoveryId, 'add') },
        { icon: 'lock', label: t('Keep this copy separate'), onClick: () => decide(copy.recoveryId, 'keep') },
      ] : []),
    ] })} />)
}
