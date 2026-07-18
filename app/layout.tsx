import { ClerkProvider } from '@clerk/nextjs'
import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Habits',
  description: 'Track daily habits with friends.',
  manifest: '/manifest.json',
  icons: {
    // Browser tab / favicon (SVG is fine here).
    icon: '/favicon.svg',
    // iOS home-screen icon MUST be a raster PNG — iOS ignores SVG
    // apple-touch-icons and falls back to a page screenshot.
    apple: '/icon-180.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Habits',
  },
  // Next only emits `mobile-web-app-capable` from appleWebApp; add the
  // apple-prefixed variant for older iOS versions that need it for standalone.
  other: {
    'apple-mobile-web-app-capable': 'yes',
  },
}

export const viewport: Viewport = {
  themeColor: '#ffffff',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className="antialiased">{children}</body>
      </html>
    </ClerkProvider>
  )
}
