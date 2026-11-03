import { zipSync, strToU8 } from "fflate";

/** Zip fallback — download the whole exported app as booklith-<slug>.zip. */
export function downloadZip(files: Record<string, string>, name: string): void {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "book";
  const u8: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files)) {
    u8[path] = strToU8(content);
  }
  const zipped = zipSync(u8, { level: 6 });
  const blob = new Blob([zipped as unknown as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug}.zip`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
