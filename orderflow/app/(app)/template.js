'use client'
// Re-mounts on every navigation, easing each page in as one motion so moving
// between sections feels like one integrated app instead of separate pages.
export default function Template({ children }) {
  return <div className="page-fade">{children}</div>
}
