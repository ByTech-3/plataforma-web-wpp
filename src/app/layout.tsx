import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

/**
 * Uma família só, carregada pelo `next/font` (sem requisição extra em runtime
 * e sem salto de layout). A escala de tamanhos vive em `components/ui.ts`.
 */
const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ByTech3 · Plataforma',
  description: 'CRM integrado ao WhatsApp Web',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="pt-BR" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
