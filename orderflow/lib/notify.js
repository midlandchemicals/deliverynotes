// Tiny DOM toast usable from any client component without context/providers.
// toast('Saved') for confirmations; toastError('Could not save: …') stays up
// longer and is styled as an error so failed writes are never silent.
export function toast(msg, { error = false, ms } = {}) {
  if (typeof document === 'undefined') return
  let t = document.getElementById('toast')
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t) }
  t.textContent = msg
  t.classList.toggle('err', !!error)
  t.classList.add('show')
  clearTimeout(t._t)
  t._t = setTimeout(() => t.classList.remove('show'), ms || (error ? 5000 : 1900))
}

export function toastError(msg) { toast(msg, { error: true }) }

// Wrap a Supabase write result: shows an error toast and returns false if it
// failed, true otherwise.  usage: ok(await supabase.from(...).update(...), 'saving customer')
export function ok(res, what = 'saving') {
  if (res?.error) {
    toastError(`Problem ${what}: ${res.error.message}. Your change may NOT be saved.`)
    return false
  }
  return true
}
