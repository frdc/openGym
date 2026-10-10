import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { Button } from '../components/ui.jsx'
import { openPasswordSignIn, openPasswordRegister } from '../components/PasswordAuth.jsx'
export default function MobileOnboarding() {
  return <div className="narrow" style={{ paddingTop: '20vh', textAlign: 'center' }}>
    <h1>openGym</h1>
    <p>{t('How do you want to use openGym?')}</p>
    <Button variant="primary" onClick={() => useStore.getState().setGuest(true)}>{t('Use on this device')}</Button>
    <Button onClick={openPasswordSignIn}>{t('Sign in')}</Button>
    <Button onClick={openPasswordRegister}>{t('Create account')}</Button>
    <p className="dim small">{t('Your data lives on this device. Sign in to sync.')}</p>
  </div>
}
