import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { DEMO } from '../lib/demo.js'
import { connectionView, actionLabel, syncNowWithToast, signInAgain, useOnline } from './ServerSync.jsx'
import Icon from './Icon.jsx'

// Brief cloud writes get a grace period; local write failures are shown immediately.
export const PENDING_GRACE_MS = 5000

/* Local durability and cloud synchronization have separate states. The banner shares its
   status with Home's indicator when hidden in Settings. It reserves space with --conn so
   workout controls stay visible; the explicit development demo supplies its own status. */
// What the indicator would say right now, and whether it would say it: shared by the banner and
// by the dot that stands in for it when the banner is switched off (useConnectionTrouble).
function useConnection() {
  const user = useStore(s => s.user)
  const sync = useStore(s => s.sync)
  const guest = useStore(s => s.isGuest())
  const onboarding = useStore(s => s.needsMobileOnboarding)
  const online = useOnline()
  const [waited, setWaited] = useState(false)
  const status = sync?.local === 'error' ? 'local-error' : sync?.local === 'saving' ? 'saving' : sync?.cloud
  useEffect(() => {
    setWaited(false)
    if (!['pending', 'syncing'].includes(status)) return
    const tm = setTimeout(() => setWaited(true), PENDING_GRACE_MS)
    return () => clearTimeout(tm)
  }, [status])

  const view = connectionView({ ...sync, guest }, { online })
  // Signed out on the web, the sign-in screen is the whole app: it hears only that the server
  // ended the session, and that the changes are still here.
  const show = !DEMO && !onboarding && !!view?.banner && (!!user || guest || status === 'auth') && (!['pending', 'syncing'].includes(status) || waited)
  return { view, show, user, status }
}

// "Show connection status" (#369, #330): on by default, and an older profile without the key
// reads as on. Off hides the banner — for a phone kept local on purpose it is a line that never
// goes — but a sync that is stuck still has to be noticed somewhere.
export const showsConnection = S => S?.connStatus !== false

/* True while the banner is switched off and the connection has a problem worth seeing: offline,
   the server unreachable or answering with an error, refusing this device, a sign-in question
   still open, or changes waiting past the grace period. Never for a device with no server at all
   (a phone kept local, a guest): that is a choice, not a fault. The Home tab and the Settings
   gear carry a dot for it. */
export function useConnectionTrouble() {
  const on = useStore(s => showsConnection(s.S))
  const { view, show } = useConnection()
  return !on && show && (view.tone === 'off' || view.tone === 'bad' || view.tone === 'wait')
}

export default function SyncBanner() {
  const nav = useNavigate()
  const on = useStore(s => showsConnection(s.S))
  const conn = useConnection()
  const { view, user, status } = conn
  const show = conn.show && on
  const row = useRef(null)

  useLayoutEffect(() => {
    const root = document.documentElement
    const el = row.current
    if (!show || !el) { root.style.removeProperty('--conn'); return }
    const fit = () => root.style.setProperty('--conn', el.offsetHeight + 'px')
    fit()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null
    ro?.observe(el)
    return () => { ro?.disconnect(); root.style.removeProperty('--conn') }
  }, [show])

  if (!show) return null
  const act = {
    retry: () => { syncNowWithToast() },
    local: syncNowWithToast,
    review: () => nav('/settings/account'),
    // Signed in, or with a session the server ended: the passkey right here. A guest goes to
    // Settings, where signing in sits next to creating a profile.
    signin: () => (user || status === 'auth' ? signInAgain() : nav('/settings/account')),
  }[view.action]
  const label = actionLabel(view)
  const inner = <>
    <Icon name={view.icon} />
    <span className="conn-t">{view.banner}</span>
    {act && label && <span className="conn-a">{label}</span>}
  </>
  return <div className={'conn-bar ' + view.tone}>
    <div className="conn-row" ref={row} role="status" aria-live="polite">
      {act ? <button className="conn" onClick={act}>{inner}</button> : <div className="conn">{inner}</div>}
    </div>
  </div>
}
