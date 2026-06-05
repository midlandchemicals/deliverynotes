import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Nav from './Nav'

export default async function AppLayout({ children }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return (
    <div className="shell">
      <Nav email={user.email} />
      {children}
    </div>
  )
}
