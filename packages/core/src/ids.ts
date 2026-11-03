/**
 * Stable, deterministic block/chapter IDs.
 *
 * Assigned by the pipeline in reading order and NEVER regenerated, so a
 * citation like "p-0042" stays meaningful from build time through export.
 */

const PAD = {
  paragraph: 4,
  heading: 3,
  figure: 3,
  table: 3,
  chapter: 2,
} as const;

const PREFIX = {
  paragraph: "p",
  heading: "h",
  figure: "fig",
  table: "tbl",
  chapter: "c",
} as const;

export type IdType = keyof typeof PREFIX;

export function blockId(type: IdType, n: number): string {
  return `${PREFIX[type]}-${String(n).padStart(PAD[type], "0")}`;
}

export function parseBlockId(id: string): { type: IdType; n: number } | null {
  const m = /^(p|h|fig|tbl|c)-(\d+)$/.exec(id);
  if (!m) return null;
  const type = (Object.keys(PREFIX) as IdType[]).find((t) => PREFIX[t] === m[1]);
  if (!type) return null;
  return { type, n: parseInt(m[2], 10) };
}
