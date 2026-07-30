import './globals.css'

export const metadata = {
  title: 'Midland Chemicals — Orders',
  description: 'Order intake & dispatch notes',
}

// Without this a phone lays the page out at ~980px and shrinks it to fit, so
// every mobile rule below 860px never applies and everything comes out tiny.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
