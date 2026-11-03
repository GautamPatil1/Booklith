import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "../../template/app/globals.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Booklith — turn any PDF book into a living book website",
  description:
    "Booklith converts a PDF book into an exportable, AI-powered book website. Built on Meta's Muse models (Wonder, Spark, Image, Voice Transcribe) + Modal OCR/TTS. Bring your own keys — Booklith hosts nothing.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
