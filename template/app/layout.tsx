import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";
import { book } from "../lib/book";

export const metadata: Metadata = {
  title: book.meta.title,
  description: book.meta.description ?? `An AI-powered reading of ${book.meta.title}.`,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={book.meta.language || "en"}>
      <body>{children}</body>
    </html>
  );
}
