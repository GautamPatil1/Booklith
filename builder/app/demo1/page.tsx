import type { Metadata } from "next";
import type { Book as ReaderBook } from "@template/lib/booklith";
import Reader from "@template/components/Reader";
import bookJson from "../../../sample/sherlock-holmes/book.json";

const book = bookJson as ReaderBook;

export const metadata: Metadata = {
  title: "The Adventures of Sherlock Holmes — Booklith demo",
  description: "Explore a Booklith reader demo with The Adventures of Sherlock Holmes by Arthur Conan Doyle.",
};

export default function SherlockDemo() {
  return <Reader book={book} />;
}
