# OrderFlow — order intake & dispatch notes

A small internal web app: log incoming orders, keep a shared order log, and
generate delivery/dispatch note PDFs (net & gross weight auto-calculated from
specific gravity and container tare weight). Built with Next.js + Supabase,
deploys to Vercel.

## What's inside
- **Order log** with status (New → In progress → Dispatched → Invoiced), search and filter.
- **New order** intake — pulls customer from the address book, captures PO ref, dates, lines, notes.
- **Order detail** — one click turns the order into a delivery-note PDF and marks it Dispatched. Every generated note is stored and can be re-downloaded.
- **Catalogs** — products (with specific gravity + packing class), packaging/containers (volume + tare), customers, and four letterheads.
- **Individual logins** via Supabase Auth. All signed-in users share the same live data.

---

## Setup (about 15 minutes, one time)

### 1. Create a Supabase project
1. Go to supabase.com, create a free project. Note the database password.
2. In the project, open **SQL Editor**, paste the contents of `supabase/schema.sql`, and click **Run**. This creates all tables, security rules, and some sample products/containers/letterheads.

### 2. Create user logins
There is no public sign-up (intentional). In Supabase:
- **Authentication → Users → Add user** — create one per person with an email and password.
- (Optional) Authentication → Providers → Email: turn **off** "Confirm email" so accounts work immediately without an email round-trip.

### 3. Get your API keys
- **Project Settings → API**: copy the **Project URL** and the **anon public** key.

### 4. Configure the app
```bash
cp .env.local.example .env.local
```
Edit `.env.local` and paste in your URL and anon key.

### 5. Run locally
```bash
npm install
npm run dev
```
Open http://localhost:3000 — you'll be redirected to /login. Sign in with a user you created.

---

## Deploy to Vercel
1. Push this folder to a GitHub repo.
2. In Vercel, **Add New → Project**, import the repo.
3. Under **Environment Variables**, add the same two:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
4. Deploy. That's it — it's live for everyone you created an account for.

(Or, from this folder: `npm i -g vercel && vercel`, then add the two env vars when prompted / in the dashboard.)

---

## How weights are calculated
- **Net weight** = container volume (L) × product specific gravity (kg/L) × quantity
- **Gross weight** = net + (container tare weight × quantity)

Tare weights in the seed data are placeholders — set your real empty-container
weights under **Packaging**.

## Notes & next steps
- One order maps to one delivery note (per your spec). Partial deliveries would
  need an extra table; easy to add later.
- Logos are stored inline (base64) on the letterhead row — fine for small logos.
  For large images, switch to Supabase Storage later.
- To add invoicing/pricing, extend the `products` table with a price column and
  add money columns to the PDF — deliberately left out for now.
