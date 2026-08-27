'use client'
import { useState, useEffect } from 'react'
import { fetchIsAdmin, fetchIsRahul, fetchCanSeePurchasing } from '@/lib/roles'
import { toastError } from '@/lib/notify'

// Role-based pricing visibility (replaces the old password gate).
// Admin users (app_users.role = 'admin') see pricing; everyone else sees
// nothing at all — the sections simply don't exist for them.

export function useIsAdmin() {
  const [isAdmin, setIsAdmin] = useState(null) // null = still checking
  useEffect(() => { fetchIsAdmin().then(setIsAdmin) }, [])
  return isAdmin
}

// Same shape, but for the single Rahul-only leads tracker. null = still checking.
export function useIsRahul() {
  const [isRahul, setIsRahul] = useState(null)
  useEffect(() => { fetchIsRahul().then(setIsRahul) }, [])
  return isRahul
}

// Admins plus Rob — who may open Purchasing without being an admin elsewhere.
export function useCanSeePurchasing() {
  const [can, setCan] = useState(null)
  useEffect(() => { fetchCanSeePurchasing().then(setCan) }, [])
  return can
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
