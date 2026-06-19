import SettingsNav from './SettingsNav'

export default function SettingsLayout({ children }) {
  return (
    <div>
      <SettingsNav />
      {children}
    </div>
  )
}
