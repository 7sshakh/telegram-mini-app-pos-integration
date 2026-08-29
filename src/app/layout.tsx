import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import Script from "next/script";

import "./globals.css";

export const metadata: Metadata = {
  title: "VIBE — HotDog · Burger · Drinks",
  description: "VIBE Telegram Mini App — hotdog, burger va ichimliklarni tez buyurtma qiling.",
  robots: { index: false, follow: false },
  applicationName: "VIBE Mini App",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#07070b",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="uz">
      <body className="bg-ink text-white antialiased">
        {/* Telegram WebApp SDK must be present before the Mini App boots. */}
        <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
        {children}
      </body>
    </html>
  );
}
