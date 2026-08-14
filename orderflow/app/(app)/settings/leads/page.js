'use client'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { prettyDate, todayISO } from '@/lib/calc'
import { ok, toast, toastError } from '@/lib/notify'
import { useIsRahul } from '@/app/(app)/PricingGuard'

// Leads — Rahul's cold-outreach pipeline for winning new customers.
// Private to him (see useIsRahul + the "rahul only" RLS policy on the table).
// Each lead moves through outreach stages (email → acknowledged → LinkedIn
// followed → LinkedIn messaged) and is filed under one of three industries.

const INDUSTRIES = [
  ['construction', 'Construction'],
  ['automotive', 'Automotive'],
  ['speciality', 'Speciality'],
]
const INDUSTRY_LABEL = Object.fromEntries(INDUSTRIES)

const STATUSES = [
  ['new', 'New'],
  ['contacted', 'Contacted'],
  ['in_conversation', 'In conversation'],
  ['won', 'Won'],
  ['lost', 'Lost'],
]
const STATUS_LABEL = Object.fromEntries(STATUSES)

// The outreach steps, in the order they normally happen. Each maps to a
// boolean flag and its companion date column on the row.
const STAGES = [
  ['email_sent', 'email_sent_at', 'Email sent'],
  ['acknowledged', 'acknowledged_at', 'Acknowledged'],
  ['linkedin_followed', 'linkedin_followed_at', 'LinkedIn followed'],
  ['linkedin_messaged', 'linkedin_messaged_at', 'LinkedIn messaged'],
]

const blankLead = () => ({
  company: '', industry: 'construction', contact_name: '', contact_role: '',
  email: '', phone: '', website: '', linkedin: '',
  email_sent: false, email_sent_at: null,
  acknowledged: false, acknowledged_at: null,
  linkedin_followed: false, linkedin_followed_at: null,
  linkedin_messaged: false, linkedin_messaged_at: null,
  status: 'new', notes: '',
})

// Most recent thing that happened to a lead — used to sort by activity.
function lastActivity(l) {
  const dates = STAGES.map(([, at]) => l[at]).filter(Boolean)
  return dates.sort().slice(-1)[0] || null
}

export default function LeadsPage() {
  const supabase = createClient()
  const isRahul = useIsRahul()
  const [rows, setRows] = useState(null)
  const [tab, setTab] = useState('all')      // all | construction | automotive | speciality
  const [q, setQ] = useState('')
  const [edit, setEdit] = useState(null)      // the lead being added/edited (a draft)
  const [busy, setBusy] = useState(false)

  async function load() {
    const { data, error } = await supabase.from('leads').select('*').order('created_at', { ascending: false })
    if (error) { toastError('Could not load leads: ' + error.message); setRows([]); return }
    setRows(data || [])
  }
  useEffect(() => { if (isRahul) load() }, [isRahul])

  const counts = useMemo(() => {
    const c = { all: (rows || []).length, construction: 0, automotive: 0, speciality: 0 }
    for (const r of rows || []) if (c[r.industry] != null) c[r.industry]++
    return c
  }, [rows])

  const stageCounts = useMemo(() => {
    const c = { email_sent: 0, acknowledged: 0, linkedin_followed: 0, linkedin_messaged: 0, won: 0 }
    for (const r of rows || []) {
      for (const [flag] of STAGES) if (r[flag]) c[flag]++
      if (r.status === 'won') c.won++
    }
    return c
  }, [rows])

  const shown = useMemo(() => {
    let list = (rows || []).filter((r) => tab === 'all' || r.industry === tab)
    const term = q.trim().toLowerCase()
    if (term) {
      list = list.filter((r) => [r.company, r.contact_name, r.contact_role, r.email, r.website]
        .some((v) => (v || '').toLowerCase().includes(term)))
    }
    // Most recently active first; never-contacted leads (newest added) after.
    return list.sort((a, b) => {
      const la = lastActivity(a), lb = lastActivity(b)
      if (la && lb) return la < lb ? 1 : -1
      if (la) return -1
      if (lb) return 1
      return (a.created_at < b.created_at ? 1 : -1)
    })
  }, [rows, tab, q])

  // Toggling a stage stamps today's date when it goes on and clears it when off,
  // so the timeline is kept without anyone typing a date.
  function toggleStage(flag, at) {
    setEdit((e) => {
      const on = !e[flag]
      return { ...e, [flag]: on, [at]: on ? (e[at] || todayISO()) : null }
    })
  }

  async function save() {
    const d = edit
    if (!d.company.trim()) { toastError('A company name is needed'); return }
    setBusy(true)
    const { data: { user } } = await supabase.auth.getUser()
    const payload = {
      company: d.company.trim(), industry: d.industry,
      contact_name: d.contact_name.trim(), contact_role: d.contact_role.trim(),
      email: d.email.trim(), phone: d.phone.trim(), website: d.website.trim(), linkedin: d.linkedin.trim(),
      email_sent: d.email_sent, email_sent_at: d.email_sent_at,
      acknowledged: d.acknowledged, acknowledged_at: d.acknowledged_at,
      linkedin_followed: d.linkedin_followed, linkedin_followed_at: d.linkedin_followed_at,
      linkedin_messaged: d.linkedin_messaged, linkedin_messaged_at: d.linkedin_messaged_at,
      status: d.status, notes: d.notes, updated_at: new Date().toISOString(),
    }
    const res = d.id
      ? await supabase.from('leads').update(payload).eq('id', d.id)
      : await supabase.from('leads').insert({ ...payload, created_by: user?.id || null })
    setBusy(false)
    if (!ok(res, 'saving the lead')) return
    toast(d.id ? 'Lead updated' : 'Lead added')
    setEdit(null); load()
  }

  async function removeLead(l) {
    if (!confirm(`Delete this lead?\n\n${l.company}`)) return
    if (!ok(await supabase.from('leads').delete().eq('id', l.id), 'deleting the lead')) return
    setEdit(null); load()
  }

  if (isRahul === null) return null
  if (!isRahul) return <div className="card"><div className="empty">This page is private.</div></div>
  if (rows === null) return (
    <div className="card"><div className="skel skel-title" />{[0, 1, 2, 3].map((i) => <div key={i} className="skel skel-row" />)}</div>
  )

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Leads</h1>
          <div className="sub">
            Cold-outreach pipeline for new customers — {counts.all} lead{counts.all === 1 ? '' : 's'} on file
          </div>
        </div>
        <button className="btn btn-a" onClick={() => setEdit(blankLead())}>＋ Add a lead</button>
      </div>

      <div className="stat-row">
        <Stat label="Total leads" value={String(counts.all)} big />
        <Stat label="Emails sent" value={String(stageCounts.email_sent)} />
        <Stat label="Acknowledged" value={String(stageCounts.acknowledged)} />
        <Stat label="LinkedIn messaged" value={String(stageCounts.linkedin_messaged)} />
        <Stat label="Won" value={String(stageCounts.won)} />
      </div>

      <div className="sub-nav">
        {[['all', `All (${counts.all})`], ...INDUSTRIES.map(([k, l]) => [k, `${l} (${counts[k]})`])].map(([k, label]) => (
          <a key={k} className={tab === k ? 'on' : ''} style={{ cursor: 'pointer' }} onClick={() => setTab(k)}>{label}</a>
        ))}
      </div>

      <div className="filters">
        <input placeholder="Search company, contact, email…" value={q} onChange={(e) => setQ(e.target.value)} />
        {q && <span className="muted" style={{ fontSize: 12.5 }}>{shown.length} match{shown.length === 1 ? '' : 'es'}</span>}
      </div>

      <div className="card">
        {counts.all === 0 ? <div className="empty">No leads yet — add the first company you want to reach out to.</div>
          : shown.length === 0 ? <div className="empty">Nothing matches.</div> : (
          <table className="tbl tbl-cards">
            <thead><tr>
              <th>Company</th><th>Industry</th><th>Contact</th>
              <th>Outreach</th><th>Status</th>
              <th style={{ textAlign: 'right' }}>Last activity</th>
            </tr></thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.id} style={{ cursor: 'pointer' }} onClick={() => setEdit({ ...l })}>
                  <td data-label="Company">
                    <span style={{ fontWeight: 600, color: 'var(--heading)' }}>{l.company}</span>
                    {l.website && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{l.website}</div>}
                  </td>
                  <td data-label="Industry"><IndustryChip industry={l.industry} /></td>
                  <td data-label="Contact">
                    {l.contact_name || <span className="muted">—</span>}
                    {l.contact_role && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{l.contact_role}</div>}
                  </td>
                  <td data-label="Outreach"><StageDots lead={l} /></td>
                  <td data-label="Status"><StatusChip status={l.status} /></td>
                  <td className="mono" style={{ textAlign: 'right' }} data-label="Last activity">
                    {lastActivity(l) ? prettyDate(lastActivity(l)) : <span className="muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {edit && (
        <div className="modal-bg" onClick={() => !busy && setEdit(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 620, textAlign: 'left' }}>
            <div className="ttl" style={{ marginBottom: 8 }}>
              <h2 style={{ margin: 0 }}>{edit.id ? 'Edit lead' : 'Add a lead'}</h2>
              <button className="btn btn-g btn-sm" onClick={() => setEdit(null)}>Close</button>
            </div>

            <div className="row c2" style={{ marginBottom: 0 }}>
              <div className="field"><label>Company *</label>
                <input value={edit.company} autoFocus onChange={(e) => setEdit((d) => ({ ...d, company: e.target.value }))} /></div>
              <div className="field"><label>Industry</label>
                <select value={edit.industry} onChange={(e) => setEdit((d) => ({ ...d, industry: e.target.value }))}>
                  {INDUSTRIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select></div>
            </div>

            <div className="row c2" style={{ marginBottom: 0 }}>
              <div className="field"><label>Contact name</label>
                <input value={edit.contact_name} onChange={(e) => setEdit((d) => ({ ...d, contact_name: e.target.value }))} /></div>
              <div className="field"><label>Role / title</label>
                <input value={edit.contact_role} onChange={(e) => setEdit((d) => ({ ...d, contact_role: e.target.value }))} /></div>
            </div>

            <div className="row c2" style={{ marginBottom: 0 }}>
              <div className="field"><label>Email</label>
                <input type="email" value={edit.email} onChange={(e) => setEdit((d) => ({ ...d, email: e.target.value }))} /></div>
              <div className="field"><label>Phone</label>
                <input value={edit.phone} onChange={(e) => setEdit((d) => ({ ...d, phone: e.target.value }))} /></div>
            </div>

            <div className="row c2" style={{ marginBottom: 0 }}>
              <div className="field"><label>Website</label>
                <input value={edit.website} placeholder="example.co.uk" onChange={(e) => setEdit((d) => ({ ...d, website: e.target.value }))} /></div>
              <div className="field"><label>LinkedIn</label>
                <input value={edit.linkedin} placeholder="linkedin.com/company/…" onChange={(e) => setEdit((d) => ({ ...d, linkedin: e.target.value }))} /></div>
            </div>

            <div className="field">
              <label>Outreach — tick each step as you do it</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                {STAGES.map(([flag, at, label]) => (
                  <div key={flag} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <button type="button" onClick={() => toggleStage(flag, at)}
                      className={'stage-toggle' + (edit[flag] ? ' on' : '')}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 12px', borderRadius: 8,
                        border: '1px solid ' + (edit[flag] ? 'var(--accent)' : 'var(--line-solid)'),
                        background: edit[flag] ? 'var(--accent)' : 'var(--panel-2)',
                        color: edit[flag] ? '#fff' : 'var(--heading)', fontWeight: 600, fontSize: 13, cursor: 'pointer',
                        minWidth: 190, justifyContent: 'flex-start',
                      }}>
                      <span>{edit[flag] ? '✓' : '○'}</span>{label}
                    </button>
                    {edit[flag] && (
                      <input className="mono" type="date" value={edit[at] || todayISO()}
                        onChange={(e) => setEdit((d) => ({ ...d, [at]: e.target.value }))}
                        style={{ maxWidth: 160 }} />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="field"><label>Status</label>
              <select value={edit.status} onChange={(e) => setEdit((d) => ({ ...d, status: e.target.value }))}>
                {STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select></div>

            <div className="field"><label>Notes</label>
              <textarea rows={4} value={edit.notes} onChange={(e) => setEdit((d) => ({ ...d, notes: e.target.value }))}
                placeholder="Anything worth remembering — what they buy now, who introduced you, next step…" /></div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', marginTop: 14 }}>
              <div>
                {edit.id && <button className="btn btn-g" disabled={busy} style={{ color: 'var(--bad)' }} onClick={() => removeLead(edit)}>Delete</button>}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-g" disabled={busy} onClick={() => setEdit(null)}>Cancel</button>
                <button className="btn btn-a" disabled={busy} onClick={save}>{busy ? 'Saving…' : edit.id ? 'Save changes' : 'Add lead'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function IndustryChip({ industry }) {
  const colours = {
    construction: { bg: '#FBEEDD', fg: '#8A5A18' },
    automotive: { bg: '#E4EEFB', fg: '#274C86' },
    speciality: { bg: '#EAE4FB', fg: '#4B2F86' },
  }
  const c = colours[industry] || { bg: 'var(--chip-bg)', fg: 'var(--muted)' }
  return (
    <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 6, padding: '2px 8px', background: c.bg, color: c.fg, whiteSpace: 'nowrap' }}>
      {INDUSTRY_LABEL[industry] || industry}
    </span>
  )
}

function StatusChip({ status }) {
  const colours = {
    won: { bg: '#DFF3E4', fg: '#1F6B3A' },
    lost: { bg: '#F6E1DE', fg: '#8A2F26' },
    in_conversation: { bg: '#E4EEFB', fg: '#274C86' },
  }
  const c = colours[status] || { bg: 'var(--chip-bg)', fg: 'var(--muted)' }
  return (
    <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 6, padding: '2px 8px', background: c.bg, color: c.fg, whiteSpace: 'nowrap' }}>
      {STATUS_LABEL[status] || status}
    </span>
  )
}

// Four dots, one per outreach step — filled once that step is done.
function StageDots({ lead }) {
  const short = { email_sent: 'E', acknowledged: 'A', linkedin_followed: 'F', linkedin_messaged: 'M' }
  return (
    <span style={{ display: 'inline-flex', gap: 5 }}>
      {STAGES.map(([flag, , label]) => (
        <span key={flag} title={label + (lead[flag] ? ' ✓' : ' — not yet')}
          style={{
            width: 20, height: 20, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 10, fontWeight: 700,
            background: lead[flag] ? 'var(--accent)' : 'var(--panel-2)',
            color: lead[flag] ? '#fff' : 'var(--muted)',
            border: '1px solid ' + (lead[flag] ? 'var(--accent)' : 'var(--line-solid)'),
          }}>
          {short[flag]}
        </span>
      ))}
    </span>
  )
}

function Stat({ label, value, sub, big }) {
  return (
    <div className="stat-tile">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={big ? { fontSize: 21 } : undefined}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}
