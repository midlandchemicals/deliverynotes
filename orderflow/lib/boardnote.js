'use client'
// The 80mm "post-it" board note — a compact print of an order for the wall
// board. Used from the order page and the Order Book's print button.
import { computeLine, prettyDate } from '@/lib/calc'

export function printBoardNote(order, products, packaging) {
  const items = (order.lines || []).map((l) => {
    const c = computeLine(l, products, packaging)
    return { name: c.productName, qty: c.qty, pack: c.packaging?.name || '' }
  }).filter((it) => it.name)
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${order.order_no}</title>
<style>
@page{size:80mm auto;margin:4mm}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,Helvetica,sans-serif;font-size:13pt;color:#000;background:#fff;width:72mm}
.dn{font-size:15pt;font-weight:700;border-bottom:2px solid #000;padding-bottom:2.5mm;margin-bottom:3mm}
.cust{font-size:18pt;font-weight:700;margin-bottom:3mm;line-height:1.2}
.dates{font-size:11pt;margin-bottom:4mm;line-height:1.6}
.ph{font-size:10pt;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
    border-bottom:1px solid #000;padding-bottom:1mm;margin-bottom:2.5mm}
ul{list-style:disc;padding-left:5mm}
li{font-size:13pt;margin-bottom:2.5mm;line-height:1.3}
b{font-weight:700}
</style>
</head><body>
<div class="dn">${order.order_no}</div>
<div class="cust">${order.customer_snapshot?.name || ''}</div>
<div class="dates">
  <div>Ordered: <b>${prettyDate(order.order_date)}</b></div>
  ${order.requested_date ? `<div>Required: <b>${prettyDate(order.requested_date)}</b></div>` : ''}
</div>
<div class="ph">Products</div>
<ul>
${items.map((it) => `  <li>${it.name}${it.pack ? ` — ${it.qty} x ${it.pack}` : ` (qty ${it.qty})`}</li>`).join('\n')}
</ul>
</body></html>`
  const w = window.open('', '_blank', 'width=420,height=600')
  if (!w) return
  w.document.write(html)
  w.document.close()
  w.focus()
  w.print()
}
