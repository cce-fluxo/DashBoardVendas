import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import './globals.css'
import { ThemeProvider } from '@/components/theme-provider'

export const metadata: Metadata = {
  title: 'Dashboard Comercial Fluxo',
  description: 'Dashboard analítico-comparativo · Setor comercial',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR" className={GeistSans.className} suppressHydrationWarning>
      <body className="bg-background text-foreground antialiased">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  )
}
