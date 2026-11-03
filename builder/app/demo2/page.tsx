import type { Metadata } from "next";
import type { Book as ReaderBook } from "@template/lib/booklith";
import Reader from "@template/components/Reader";
import bookJson from "../../../sample/vinoba/book.json";

const book = bookJson as ReaderBook;

export const metadata: Metadata = {
  title: "Vinoba — Booklith demo",
  description: "Explore a Booklith reader demo with a sample Marathi book by Vinoba Bhave.",
};

export default function VinobaDemo() {
  return <Reader book={book} />;
}
