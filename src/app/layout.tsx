import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

const inter = localFont({
  src: '../../public/fonts/inter-latin.woff2',
  weight: '100 900',
  display: 'swap',
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Printex Order Monitoring System",
  description: "Manajemen order dan produksi Printex.",
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" data-theme="light" suppressHydrationWarning className={`${inter.variable} h-full antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){var theme='light';try{if(localStorage.getItem('printex-theme')==='dark')theme='dark'}catch(e){}document.documentElement.classList.toggle('dark',theme==='dark');document.documentElement.dataset.theme=theme})()` }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
