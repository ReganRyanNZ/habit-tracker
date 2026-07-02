import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Habits',
  description: 'Track daily habits with friends. No login required.',
  icons: {
    icon: '/favicon.svg',
    apple: '/favicon.svg',
  },
  ...(process.env.NODE_ENV === 'production' && {
    manifest: '/manifest.json',
  }),
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Habits',
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
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  )
}
