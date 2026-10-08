import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { openPasswordSignIn, openPasswordRegister } from '../components/PasswordAuth.jsx'
export default function Login() {
  return <div className="narrow" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center' }}>
    <div style={{ fontSize: 54, color: 'var(--acc)' }}><Icon name="dumbbell" /></div>
    <h1>openGym</h1>
    <div className="muted" style={{ marginBottom: 34 }}>{t('Your workouts. Your weights. Your profile.')}</div>
    <Button variant="primary" icon="key" onClick={openPasswordSignIn}>{t('Sign in')}</Button>
    <div style={{ height: 10 }} />
    <Button icon="plusCircle" onClick={openPasswordRegister}>{t('Create account')}</Button>
    <Button variant="ghost" onClick={() => useStore.getState().setGuest(true)}>{t('Continue without account')}</Button>
    <div className="dim small">{t('Your data lives on this device. Sign in to sync.')}</div>
  </div>
}
