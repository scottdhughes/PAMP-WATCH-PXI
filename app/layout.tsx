import './globals.css';
import type { Metadata } from 'next';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: 'PXI (PAMP Index)',
  description: 'Live PAMP Index dashboard for Aixe Capital',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
