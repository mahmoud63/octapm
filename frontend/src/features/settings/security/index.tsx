import { ContentSection } from '../components/content-section'
import { SecurityForm } from './security-form'

export function SettingsSecurity() {
  return (
    <ContentSection
      title='Security'
      desc='Add a second factor to your sign-in with an authenticator app, and keep backup codes for when your phone is not at hand.'
    >
      <SecurityForm />
    </ContentSection>
  )
}
