import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Sidebar from './Sidebar'

export default async function AppLayout({ children }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Open-order count for the sidebar badge (New + In progress)
  const { count } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .in('status', ['New', 'In progress'])

  return (
    <div className="app-shell">
      <Sidebar email={user.email} openCount={count || 0} />
      <div className="main-col">
        <div className="main-inner">
          {children}
        </div>
      </div>
    </div>
  )
}
