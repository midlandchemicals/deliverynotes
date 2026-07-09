import './globals.css'

export const metadata = {
  title: 'Midland Chemicals — Orders',
  description: 'Order intake & dispatch notes',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
