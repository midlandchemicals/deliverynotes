// Reads a pasted delivery-note screenshot with Claude vision and returns the
// delivery + invoice addresses as structured fields. Runs server-side on Vercel;
// needs ANTHROPIC_API_KEY in the environment.
export const runtime = 'nodejs'

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    delivery: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string' },
        address: { type: 'string' },
        contact: {
          type: 'object',
          additionalProperties: false,
          properties: { name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' } },
          required: ['name', 'email', 'phone'],
        },
      },
      required: ['name', 'address', 'contact'],
    },
    invoice: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string' },
        address: { type: 'string' },
        contact: {
          type: 'object',
          additionalProperties: false,
          properties: { name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' } },
          required: ['name', 'email', 'phone'],
        },
      },
      required: ['name', 'address', 'contact'],
    },
  },
  required: ['delivery', 'invoice'],
}

const INSTRUCTIONS = `You are reading a UK chemical-company delivery note (image). It has a DELIVERY ADDRESS box (usually left) and an INVOICE ADDRESS box (usually right), and often a "CONTACT TEL:" / "Order No" line beneath the boxes. Extract both addresses.

Rules:
- name = the first line of that address block (the company / farm name). KEEP that same first line as the first line of "address" too — do not remove it.
- address = the full address block, newline-separated, including the name line.
- contact.email = any email in that block; contact.phone = any phone number; contact.name = any named person ("tel Steven Shaw 01582 872 308" → name "Steven Shaw", phone "01582 872 308").
- Any instruction line under the boxes such as "CONTACT TEL: PHILIP WOODS 01582 872 282 before delivery" or "24HRS IN ADVANCE" belongs to the DELIVERY side: put the person's name/phone in delivery.contact, AND append the full instruction line to the end of delivery.address.
- Ignore the sender's own letterhead (e.g. "MIDLAND CHEMICALS LTD", "A P FARM SOLUTIONS LIMITED", "ilex EnviroSciences"), the "Delivery Note" number, dates, product/batch lines, and website URLs — those are not customer addresses.
- If a box is empty, return empty strings for its fields.
Return only the structured fields.`

export async function POST(req) {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) {
    return Response.json({ error: 'ANTHROPIC_API_KEY is not set on the server. Add it in Vercel → Settings → Environment Variables.' }, { status: 500 })
  }
  let body
  try { body = await req.json() } catch { return Response.json({ error: 'Bad request' }, { status: 400 }) }
  const { image, mediaType } = body || {}
  if (!image) return Response.json({ error: 'No image supplied' }, { status: 400 })

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 1024,
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType || 'image/png', data: image } },
            { type: 'text', text: INSTRUCTIONS },
          ],
        }],
      }),
    })

    if (!res.ok) {
      const errText = await res.text()
      return Response.json({ error: `Vision request failed (${res.status}): ${errText.slice(0, 300)}` }, { status: 502 })
    }
    const data = await res.json()
    const textBlock = (data.content || []).find((b) => b.type === 'text')
    if (!textBlock) return Response.json({ error: 'No text returned from the model' }, { status: 502 })
    let parsed
    try { parsed = JSON.parse(textBlock.text) } catch { return Response.json({ error: 'Could not parse the extracted data' }, { status: 502 }) }
    return Response.json({ result: parsed })
  } catch (e) {
    return Response.json({ error: 'Extraction error: ' + (e?.message || 'unknown') }, { status: 500 })
  }
}
