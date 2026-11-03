import Reader from "../components/Reader";
import { book } from "../lib/book";

export default function Page() {
  return <Reader book={book} />;
}
