import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Linecheck",
};

/*
 * Geist loads from Google Fonts CSS, not next/font: next/font inserts a metric-adjusted Arial
 * fallback, which changes how glyphs Geist lacks (→, ⌘) are drawn. Weights 400, 500 and 600 only.
 * Bricolage Grotesque and Instrument Serif are the landing page's display faces (src/app/landing.css).
 * Light theme only.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,700..800&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&family=Instrument+Serif:ital@1&display=swap" />
      </head>
      <body className="ic">{children}</body>
    </html>
  );
}
