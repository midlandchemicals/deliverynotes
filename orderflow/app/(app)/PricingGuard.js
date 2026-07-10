'use client'
import { useState, useEffect } from 'react'
import { fetchIsAdmin } from '@/lib/roles'
import { toastError } from '@/lib/notify'

// Role-based pricing visibility (replaces the old password gate).
// Admin users (app_users.role = 'admin') see pricing; everyone else sees
// nothing at all — the sections simply don't exist for them.

export function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState(null) // null = still checking
  useEffect(() => { fetchIsAdmin().then(setIsAdmin) }, [])
  return isAdmin
}

// Wrapper — renders children only for admins. General users see nothing
// (no blur, no lock, no hint that pricing exists).
export default function PricingGuard({ children, fallback = null }) {
  const isAdmin = useIsAdmin()
  if (isAdmin === null) return null
  return isAdmin ? <>{children}</> : fallback
}

// Hook for gating a button action (e.g. Print office copy).
// Runs the action for admins; shows a brief message for everyone else.
export function usePricingCheck() {
  const isAdmin = useIsAdmin()
  function guard(fn) {
    if (isAdmin) fn()
    else toastError('Pricing is only available to admin users.')
  }
  return { guard, ModalUI: null, isAdmin }
}
