import type { Viewport } from 'next';
import './globals.css';

export const metadata = { title: { default: 'Callboard', template: '%s · Callboard' } };
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#faf9f6' }, { media: '(prefers-color-scheme: dark)', color: '#1c1917' }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
