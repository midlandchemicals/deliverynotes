// Public short link for a proforma: /p/<token>. Looks the token up (service
// role, so no customer login needed), then redirects to a fresh short-lived
// signed URL for the stored PDF. Keeps the customer-facing link on our own
// domain instead of a long Supabase signed URL.
export const runtime = 'nodejs'

import { createAdminClient } from '@/lib/supabase/admin'

function page(title, msg) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
     <title>${title}</title>
     <div style="font-family:system-ui,sans-serif;max-width:460px;margin:16vh auto;text-align:center;color:#1A231D">
       <h1 style="font-size:20px">${title}</h1>
       <p style="color:#666">${msg}</p>
     </div>`,
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } },
  )
}

export async function GET(req, { params }) {
  const token = params?.token
  const admin = createAdminClient()
  if (!admin) return page('Unavailable', 'This link service is not configured yet.')
  if (!token) return page('Link not found', 'This proforma link is invalid.')

  const { data, error } = await admin
    .from('proforma_links').select('path, expires_at').eq('token', token).single()
  if (error || !data) return page('Link not found', 'This proforma link is invalid or has been removed.')
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return page('Link expired', 'This proforma link has expired. Please contact us for a new copy.')
  }

  const signed = await admin.storage.from('proformas').createSignedUrl(data.path, 120)
  if (signed.error || !signed.data?.signedUrl) return page('Unavailable', 'The document could not be loaded.')
  return Response.redirect(signed.data.signedUrl, 302)
}
