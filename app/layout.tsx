import type { Metadata, Viewport } from 'next'
import { Inter, JetBrains_Mono, Rye } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains-mono',
})

const rye = Rye({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-rye',
})

export const metadata: Metadata = {
  title: 'Outclaw',
  description: 'AI Assistant Chat Workspace',
  icons: {
    icon: '/icon.svg',
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fafafa' },
    { media: '(prefers-color-scheme: dark)', color: '#1a1a1a' },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark bg-background">
      <body className={`${inter.variable} ${jetbrainsMono.variable} ${rye.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  )
}
