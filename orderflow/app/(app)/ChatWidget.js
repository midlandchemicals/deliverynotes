'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toastError } from '@/lib/notify'

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
  const endRef = useRef(null)
  const withRef = useRef('')
  withRef.current = withEmail

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

  // Live delivery of anything addressed to me.
  useEffect(() => {
    if (!me) return
    const channel = supabase
      .channel('messages-' + me)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `recipient_email=eq.${me}` },
        (payload) => {
          const m = payload.new
          if (lc(m.sender_email) === lc(withRef.current)) {
            setMessages((cur) => (cur.some((x) => x.id === m.id) ? cur : [...cur, m]))
            markRead(m.sender_email)
          } else {
            setUnread((u) => ({ ...u, [m.sender_email]: (u[m.sender_email] || 0) + 1 }))
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
