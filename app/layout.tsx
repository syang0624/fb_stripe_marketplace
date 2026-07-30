import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MRI — Market Research Intelligence",
  description: "AI-powered marketplace deal finder and negotiation assistant"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* suppressHydrationWarning: browser extensions (e.g. Grammarly) inject
          attributes like data-gr-ext-installed onto <body> after SSR, causing a
          benign hydration attribute mismatch. */}
      <body
        className="min-h-screen bg-paper font-sans text-ink antialiased"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
