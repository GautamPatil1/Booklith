/**
 * Booklith reader — vendored shared types & theme catalog.
 * Copied from @booklith/core so the EXPORTED app is fully self-contained
 * (no workspace dependencies). Keep in sync with packages/core/src.
 */

export const BOOK_SCHEMA_VERSION = 1;

export interface BookMeta {
  title: string;
  authors: string[];
  language: string;
  description?: string;
  sourceProvider: string;
  createdAt: string;
}

export interface BookTheme {
  id: string;
  name: string;
}

export interface BlockBase {
  id: string;
  page?: number;
  chapterId?: string;
}

export interface HeadingBlock extends BlockBase {
  type: "heading";
  level: 1 | 2 | 3;
  text: string;
  tentative?: boolean;
}

export interface ParagraphBlock extends BlockBase {
  type: "paragraph";
  text: string;
}

export interface FigureBlock extends BlockBase {
  type: "figure";
  caption?: string;
  placeholder: string;
}

export interface TableBlock extends BlockBase {
  type: "table";
  markdown: string;
}

export type Block = HeadingBlock | ParagraphBlock | FigureBlock | TableBlock;

export interface Chapter {
  id: string;
  title: string;
  blockIds: string[];
}

export interface Book {
  schemaVersion: number;
  meta: BookMeta;
  theme: BookTheme;
  blocks: Block[];
  chapters: Chapter[];
}

export interface ThemePreset {
  id: string;
  name: string;
  vibe: string;
  palette: {
    bg: string;
    surface: string;
    text: string;
    muted: string;
    accent: string;
    accentText: string;
    border: string;
    dark?: boolean;
  };
}

export const THEME_CATALOG: ThemePreset[] = [
  {
    id: "paper",
    name: "Paper",
    vibe: "cool gray canvas, white panels, indigo accent (default)",
    palette: { bg: "#f0f1f5", surface: "#ffffff", text: "#15161c", muted: "#6b7083", accent: "#3b3fd8", accentText: "#ffffff", border: "#e5e7ee" },
  },
  {
    id: "sepia",
    name: "Sepia",
    vibe: "warm cream, easy on the eyes",
    palette: { bg: "#efe7d6", surface: "#faf5ea", text: "#3b2f24", muted: "#8a7a63", accent: "#b45309", accentText: "#fffaf0", border: "#e3d5b8" },
  },
  {
    id: "midnight",
    name: "Midnight",
    vibe: "dark, late-night reading",
    palette: { bg: "#0b0d14", surface: "#161925", text: "#e6e8f2", muted: "#9aa1b8", accent: "#7b7ff0", accentText: "#0b0d14", border: "#262a3a", dark: true },
  },
  {
    id: "forest",
    name: "Forest",
    vibe: "green scholarly calm",
    palette: { bg: "#edf3ee", surface: "#ffffff", text: "#1e3329", muted: "#5b7a6b", accent: "#15803d", accentText: "#ffffff", border: "#d3e4d3" },
  },
  {
    id: "plum",
    name: "Plum",
    vibe: "literary, purple accents",
    palette: { bg: "#f4f0f7", surface: "#ffffff", text: "#2d2233", muted: "#7a6b85", accent: "#7c3aed", accentText: "#ffffff", border: "#e8dff0" },
  },
];

export function getTheme(id: string): ThemePreset {
  return THEME_CATALOG.find((t) => t.id === id) ?? THEME_CATALOG[0];
}
