import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { askAddDeviceData } from '../sheets.jsx'
import { Button } from './ui.jsx'
export const MIN_PASSWORD = 6
export const foldEmail = value => String(value || '').trim()
export const looksLikeEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(foldEmail(value))
export function passwordError(error) {
  switch (error?.code) {
    case 'auth/invalid-email': return t('That is not an e-mail address.')
    case 'auth/weak-password': return t('Use at least {0} characters.', MIN_PASSWORD)
    case 'auth/email-already-in-use': return t('Another profile already uses this e-mail address.')
    case 'auth/invalid-credential': case 'auth/wrong-password': case 'auth/user-not-found': return t('Wrong e-mail or password.')
    case 'auth/user-disabled': return t('This account has been disabled.')
    case 'auth/too-many-requests': return t('Too many attempts. Try again later.')
    case 'auth/network-request-failed': return t('Could not connect')
    case 'auth/not-configured': return t('Cloud accounts are not configured. You can keep using this device locally.')
    default: return t('Sign-in failed')
  }
}
function AccountForm({ close, initialMode = 'signin' }) {
  const [mode, setMode] = useState(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)
  const [awaitingUid, setAwaitingUid] = useState(null)
  const request = useRef(0)
  const user = useStore(s => s.user)
  const ready = useStore(s => s.localReady)
  useEffect(() => () => { request.current++ }, [])
  // SDK results are not ownership proof. Wait for the confirmed, hydrated account.
  useEffect(() => {
    if (!awaitingUid || !ready || user?.uid !== awaitingUid) return
    setAwaitingUid(null)
    close()
    void useStore.getState().adoptProfile(askAddDeviceData).catch(() => {})
  }, [awaitingUid, ready, user?.uid, close])
  const changeMode = next => { request.current++; setMode(next); setBusy(false); setError(''); setSent(false); setAwaitingUid(null) }
  const submit = async event => {
    event.preventDefault()
    if (busy) return
    if (!looksLikeEmail(email)) { setError(t('That is not an e-mail address.')); return }
    if (mode !== 'reset' && !password) { setError(t('Enter your password.')); return }
    if (mode === 'register' && password.length < MIN_PASSWORD) { setError(t('Use at least {0} characters.', MIN_PASSWORD)); return }
    if (mode === 'register' && password !== again) { setError(t('The two passwords are not the same.')); return }
    const nonce = ++request.current
    setBusy(true); setError(''); setSent(false)
    try {
      const store = useStore.getState()
      if (mode === 'reset') {
        await store.resetPassword(foldEmail(email))
        if (nonce === request.current) setSent(true)
      } else {
        const result = await store[mode === 'register' ? 'register' : 'login'](foldEmail(email), password)
        if (nonce === request.current) setAwaitingUid(result.uid)
      }
    } catch (e) { if (nonce === request.current) setError(passwordError(e)) }
    finally { if (nonce === request.current) setBusy(false) }
  }
  return <>
    <h3>{mode === 'register' ? t('Create account') : mode === 'reset' ? t('Reset your password') : t('Sign in')}</h3>
    <form onSubmit={submit} noValidate>
      <input className="input" type="email" name="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" placeholder={t('E-mail')} value={email} onChange={e => setEmail(e.target.value)} />
      {mode !== 'reset' && <><div style={{ height: 10 }} /><input className="input" type="password" name="password" autoComplete={mode === 'register' ? 'new-password' : 'current-password'} placeholder={t('Password')} value={password} onChange={e => setPassword(e.target.value)} /></>}
      {mode === 'register' && <><div style={{ height: 10 }} /><input className="input" type="password" name="password-again" autoComplete="new-password" placeholder={t('Repeat the password')} value={again} onChange={e => setAgain(e.target.value)} /></>}
      {error && <div role="alert" className="small" style={{ color: 'var(--red)', marginTop: 10 }}>{error}</div>}
      {sent && <p role="status">{t('Check your e-mail for a password reset link.')}</p>}
      {awaitingUid && <p role="status">{t('Opening your local account…')}</p>}
      <div style={{ height: 12 }} />
      <Button type="submit" variant="primary" disabled={busy || !!awaitingUid}>{mode === 'register' ? t('Create account') : mode === 'reset' ? t('Send reset e-mail') : t('Sign in')}</Button>
    </form>
    <Button variant="ghost" onClick={() => changeMode(mode === 'reset' ? 'signin' : 'reset')}>{mode === 'reset' ? t('Sign in') : t('Reset your password')}</Button>
    <Button variant="ghost" onClick={() => { request.current++; close() }}>{t('Cancel')}</Button>
  </>
}
export const PasswordSignInSheet = props => <AccountForm {...props} />
export const PasswordRegisterForm = props => <AccountForm {...props} initialMode="register" />
export const openPasswordSignIn = () => useUI.getState().openSheet(close => <PasswordSignInSheet close={close} />, { accountAuth: true })
export const openPasswordRegister = () => useUI.getState().openSheet(close => <PasswordRegisterForm close={close} />, { accountAuth: true })
export const openPasswordReset = () => useUI.getState().openSheet(close => <AccountForm close={close} initialMode="reset" />)
