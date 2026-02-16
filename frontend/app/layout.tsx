import type { Metadata, Viewport } from 'next'

import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/toaster'

import './globals.css'

export const metadata: Metadata = {
  title: 'MAYA - Cybersecurity Deception Platform',
  description: 'Enterprise-grade cybersecurity deception and threat intelligence dashboard',
}

export const viewport: Viewport = {
  themeColor: '#0c1222',
}
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased min-h-screen" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}