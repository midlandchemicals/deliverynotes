'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast, toastError } from '@/lib/notify'

// Floating staff chat, bottom-right on every page. Collapsed it's a small bar
// with an unread count; open it's a panel with the colleague list and the
// conversation. New messages arrive live over Supabase Realtime.

const nameOf = (email) => {
  if (!email) return ''
  const local = email.split('@')[0]
  return local.split(/[._-]/).filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ')
}
const initials = (email) => nameOf(email).split(' ').map((p) => p[0]).join('').slice(0, 2) || '?'
const lc = (s) => String(s || '').trim().toLowerCase()

// Short two-note ping, synthesised rather than shipped as an audio file so
// there's nothing to load and nothing to 404. Browsers block audio until the
// page has been interacted with, which by this point it always has.
function playPing() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const note = (freq, at, len) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.connect(g); g.connect(ctx.destination)
      o.type = 'sine'
      o.frequency.value = freq
      g.gain.setValueAtTime(0.0001, ctx.currentTime + at)
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + at + 0.012)
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + len)
      o.start(ctx.currentTime + at)
      o.stop(ctx.currentTime + at + len + 0.02)
    }
    note(784, 0, 0.13)     // G5
    note(1046, 0.11, 0.22) // C6
    setTimeout(() => ctx.close(), 800)
  } catch { /* audio blocked or unsupported — the other three still fire */ }
}

function timeLabel(ts) {
  const d = new Date(ts)
  const today = new Date().toDateString() === d.toDateString()
  return today
    ? d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) + ' ' +
      d.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' })
}

export default function ChatWidget() {
  const supabase = createClient()
  const [me, setMe] = useState('')
  const [people, setPeople] = useState([])      // other staff emails
  const [open, setOpen] = useState(false)
  const [withEmail, setWithEmail] = useState('') // conversation partner
  const [messages, setMessages] = useState([])   // for the open conversation
  const [unread, setUnread] = useState({})       // email -> count
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [missing, setMissing] = useState(false)  // migration not run yet
  const [muted, setMuted] = useState(false)
  const [perm, setPerm] = useState('unsupported') // desktop notification permission
  const endRef = useRef(null)
  const withRef = useRef('')
  const openRef = useRef(false)
  const mutedRef = useRef(false)
  const baseTitle = useRef('')
  withRef.current = withEmail
  openRef.current = open
  mutedRef.current = muted   // the realtime callback is created once, so it reads the ref

  const totalUnread = Object.values(unread).reduce((a, b) => a + b, 0)

  // Who am I, and who else is there to message?
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser()
      const email = lc(user?.email)
      if (!email) return
      setMe(email)
      const { data } = await supabase.from('app_users').select('email').order('email')
      setPeople((data || []).map((r) => lc(r.email)).filter((e) => e && e !== email))
    })()
  }, [])

  // Unread tally across everyone, so the closed bar can show a count.
  const loadUnread = useCallback(async (email) => {
    const { data, error } = await supabase.from('messages')
      .select('sender_email').eq('recipient_email', email).is('read_at', null)
    if (error) { if (error.code === '42P01') setMissing(true); return }
    const counts = {}
    for (const m of data || []) counts[m.sender_email] = (counts[m.sender_email] || 0) + 1
    setUnread(counts)
  }, [])

  useEffect(() => { if (me) loadUnread(me) }, [me, loadUnread])

  // Remember the page title so the unread badge can be added and removed
  // without permanently rewriting it, and read the saved sound preference.
  useEffect(() => {
    baseTitle.current = document.title.replace(/^\(\d+\)\s*/, '')
    setMuted(localStorage.getItem('chatMuted') === '1')
    if (typeof window !== 'undefined' && 'Notification' in window) setPerm(Notification.permission)
  }, [])

  // (2) Unread count in the browser tab, so it shows even on another tab.
  useEffect(() => {
    if (!baseTitle.current) return
    document.title = totalUnread > 0 ? `(${totalUnread}) ${baseTitle.current}` : baseTitle.current
  }, [totalUnread])

  function toggleMute() {
    setMuted((m) => { localStorage.setItem('chatMuted', m ? '0' : '1'); return !m })
  }

  // (4) Desktop notifications need a one-off permission, and browsers only
  // allow the prompt in response to a click — hence the button rather than
  // asking on load.
  async function askPermission() {
    if (!('Notification' in window)) return
    const res = await Notification.requestPermission()
    setPerm(res)
    if (res === 'granted') new Notification('Notifications are on', { body: 'New messages will appear here.' })
  }

  // Everything that happens when a message lands while you're not reading it.
  function alertNewMessage(m) {
    const who = nameOf(m.sender_email)
    const preview = m.body.length > 90 ? m.body.slice(0, 90) + '…' : m.body
    toast(`💬 ${who}: ${preview}`)                       // (1) in-app toast
    if (!mutedRef.current) playPing()                    // (3) sound
    if ('Notification' in window && Notification.permission === 'granted') {
      try {                                              // (4) OS notification
        const n = new Notification(`${who} — OrderFlow`, { body: preview, tag: 'msg-' + m.sender_email })
        n.onclick = () => { window.focus(); setOpen(true); openConversation(lc(m.sender_email)); n.close() }
      } catch { /* some browsers require a service worker — the rest still fire */ }
    }
  }

  // Live delivery of anything addressed to me.
  useEffect(() => {
    if (!me) return
    const channel = supabase
      .channel('messages-' + me)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `recipient_email=eq.${me}` },
        (payload) => {
          const m = payload.new
          // Already looking at this conversation with the panel open? Just show
          // it. Otherwise it's unread, and worth interrupting them for.
          const watching = openRef.current && lc(m.sender_email) === lc(withRef.current) && !document.hidden
          if (watching) {
            setMessages((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, m]))
            markRead(m.sender_email)
          } else {
            if (lc(m.sender_email) === lc(withRef.current)) {
              setMessages((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, m]))
            }
            setUnread((u) => ({ ...u, [m.sender_email]: (u[m.sender_email] || 0) + 1 }))
            alertNewMessage(m)
          }
        })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [me])

  async function markRead(fromEmail) {
    await supabase.from('messages').update({ read_at: new Date().toISOString() })
      .eq('recipient_email', me).eq('sender_email', fromEmail).is('read_at', null)
    setUnread((u) => { const n = { ...u }; delete n[fromEmail]; return n })
  }

  async function openConversation(email) {
    setWithEmail(email)
    setMessages([])
    const { data, error } = await supabase.from('messages')
      .select('*')
      .or(`and(sender_email.eq.${me},recipient_email.eq.${email}),and(sender_email.eq.${email},recipient_email.eq.${me})`)
      .order('created_at', { ascending: true })
      .limit(200)
    if (error) { if (error.code === '42P01') setMissing(true); return }
    setMessages(data || [])
    markRead(email)
  }

  async function send() {
    const body = draft.trim()
    if (!body || !withEmail) return
    setSending(true)
    const { data, error } = await supabase.from('messages')
      .insert({ sender_email: me, recipient_email: withEmail, body })
      .select('*').single()
    setSending(false)
    if (error) { toastError('Message not sent: ' + error.message); return }
    setMessages((cur) => [...cur, data])
    setDraft('')
  }

  // Keep the newest message in view.
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [messages, open, withEmail])

  if (!me) return null

  // ── collapsed bar ─────────────────────────────────────────────────────────
  if (!open) return (
    <button className="chat-bar" onClick={() => setOpen(true)}>
      <span style={{ fontSize: 15 }}>💬</span>
      <span>Messages</span>
      {totalUnread > 0 && <span className="chat-count">{totalUnread}</span>}
    </button>
  )

  return (
    <div className="chat-panel">
      <div className="chat-head">
        {withEmail ? (
          <button className="chat-icon-btn" title="Back to everyone" onClick={() => { setWithEmail(''); loadUnread(me) }}>←</button>
        ) : <span style={{ fontSize: 15 }}>💬</span>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="chat-title">{withEmail ? nameOf(withEmail) : 'Messages'}</div>
          {withEmail && <div className="chat-sub">{withEmail}</div>}
        </div>
        <button className="chat-icon-btn" title={muted ? 'Sound off — click to turn on' : 'Sound on — click to mute'} onClick={toggleMute}>
          {muted ? '🔕' : '🔔'}
        </button>
        <button className="chat-icon-btn" title="Close" onClick={() => setOpen(false)}>✕</button>
      </div>

      {missing ? (
        <div className="chat-body">
          <p className="hint" style={{ margin: 12 }}>
            Messaging isn&apos;t switched on yet — migration <b>015_messages.sql</b> still needs running.
          </p>
        </div>
      ) : !withEmail ? (
        // ── who to message ──
        <div className="chat-body">
          {perm === 'default' && (
            <div className="chat-perm">
              <div style={{ fontWeight: 700, fontSize: 12.5, marginBottom: 2 }}>🔔 Get notified</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 }}>
                Show new messages on your desktop, even when OrderFlow is behind another window.
              </div>
              <button className="btn btn-a btn-sm" onClick={askPermission}>Turn on notifications</button>
            </div>
          )}
          {perm === 'denied' && (
            <div className="chat-perm">
              <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                🔕 Desktop notifications are blocked for this site. Turn them back on in your browser&apos;s
                site settings (the icon at the left of the address bar).
              </div>
            </div>
          )}
          {people.length === 0 ? (
            <p className="hint" style={{ margin: 12 }}>No other staff accounts found in <b>app_users</b>.</p>
          ) : people.map((email) => (
            <button key={email} className="chat-person" onClick={() => openConversation(email)}>
              <span className="chat-avatar">{initials(email)}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="chat-person-name">{nameOf(email)}</span>
              </span>
              {unread[email] > 0 && <span className="chat-count">{unread[email]}</span>}
            </button>
          ))}
        </div>
      ) : (
        // ── the conversation ──
        <>
          <div className="chat-body chat-msgs">
            {messages.length === 0 && (
              <p className="hint" style={{ textAlign: 'center', marginTop: 20 }}>
                No messages yet — say hello to {nameOf(withEmail)}.
              </p>
            )}
            {messages.map((m) => {
              const mine = lc(m.sender_email) === me
              return (
                <div key={m.id} className={'chat-msg' + (mine ? ' mine' : '')}>
                  <div className="chat-bubble">{m.body}</div>
                  <div className="chat-time">{timeLabel(m.created_at)}</div>
                </div>
              )
            })}
            <div ref={endRef} />
          </div>
          <div className="chat-compose">
            <textarea
              rows={1} value={draft} placeholder={`Message ${nameOf(withEmail)}…`}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
            />
            <button className="btn btn-a btn-sm" onClick={send} disabled={sending || !draft.trim()}>Send</button>
          </div>
        </>
      )}
    </div>
  )
}
