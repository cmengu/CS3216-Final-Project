import type { Metadata } from "next";
import { THEME_SCRIPT } from "@/state/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Invoice Checker",
};

/*
 * Fonts load exactly as the prototype loads them (Google Fonts CSS, family "Geist"), not through
 * next/font: next/font inserts a metric-adjusted Arial fallback, which changes how glyphs Geist
 * lacks (→, ⌘) are drawn compared with the approved prototype.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap" />
      </head>
      <body>{children}</body>
    </html>
  );
}
