// Default node styles per depth. Applied when a node is created, layout never restyles existing nodes.

import type { NodeData, Structure } from "./model";

export interface Branch { stroke: string; fill: string; }

export interface NodeStyle {
  fontSize: number;
  textColor: string;
  borderColor: string;
  backgroundColor: string;
  strokeWidth: number;
  padX: number;
  padY: number;
  edgeWidth: number;
}

export interface Colors {
  central: { text: string; border: string; fill: string };
  topicText: string; // text of main topics and subtopics
  summary: { text: string; border: string; fill: string }; // border also colors the brace
  boundary: { line: string; fill: string; title: string; titleFill: string };
  relationship: { line: string; text: string }; // line and arrowhead, label text
  callout: { text: string; fill: string }; // a bubble without a border; the fill also colors its tail
  branches: Branch[]; // cycled through for the main topics of a map
}

export const DEFAULT_COLORS: Colors = {
  central: { text: "#ffffff", border: "#1e1e1e", fill: "#1e1e1e" },
  topicText: "#1e1e1e",
  summary: { text: "#1e1e1e", border: "#1e1e1e", fill: "#ffffff" },
  boundary: { line: "#868e96", fill: "#e9ecef", title: "#1e1e1e", titleFill: "#adb5bd" },
  relationship: { line: "#495057", text: "#495057" },
  callout: { text: "#ffffff", fill: "#e8590c" },
  branches: [
    { stroke: "#e03131", fill: "#ffc9c9" },
    { stroke: "#1971c2", fill: "#a5d8ff" },
    { stroke: "#2f9e44", fill: "#b2f2bb" },
    { stroke: "#f08c00", fill: "#ffec99" },
    { stroke: "#9c36b5", fill: "#eebefa" },
    { stroke: "#0c8599", fill: "#99e9f2" },
  ],
};

/** A built-in theme, a fixed palette. */
export type Preset = "classic" | "pastel" | "ocean" | "sunset" | "forest" | "monochrome";

export const PRESETS: Record<Preset, string> = {
  classic: "Classic",
  pastel: "Pastel",
  ocean: "Ocean",
  sunset: "Sunset",
  forest: "Forest",
  monochrome: "Monochrome",
};

/** A theme the user made in the settings, or imported. */
export interface UserTheme {
  id: string;
  name: string;
  colors: Colors;
}

/**
 * A map's colors, by id: a preset, or one of the user's themes. Each map keeps its own, stored on its central topic.
 */
export type Theme = string;

/** The user theme made from the single set of colors the settings had before themes, which maps made then have. */
export const CUSTOM_THEME = "custom";

const PALETTES: Record<Preset, Colors> = {
  classic: DEFAULT_COLORS,
  pastel: {
    central: { text: "#343a40", border: "#9775fa", fill: "#e5dbff" },
    topicText: "#343a40",
    summary: { text: "#343a40", border: "#adb5bd", fill: "#f8f9fa" },
    boundary: { line: "#ced4da", fill: "#f8f9fa", title: "#495057", titleFill: "#e9ecef" },
    relationship: { line: "#868e96", text: "#868e96" },
    callout: { text: "#ffffff", fill: "#9775fa" },
    branches: [
      { stroke: "#ff8787", fill: "#fff5f5" },
      { stroke: "#74c0fc", fill: "#e7f5ff" },
      { stroke: "#8ce99a", fill: "#ebfbee" },
      { stroke: "#ffd43b", fill: "#fff9db" },
      { stroke: "#e599f7", fill: "#f8f0fc" },
      { stroke: "#66d9e8", fill: "#e3fafc" },
    ],
  },
  ocean: {
    central: { text: "#ffffff", border: "#0b7285", fill: "#0b7285" },
    topicText: "#102a43",
    summary: { text: "#102a43", border: "#1864ab", fill: "#e7f5ff" },
    boundary: { line: "#74c0fc", fill: "#e7f5ff", title: "#102a43", titleFill: "#a5d8ff" },
    relationship: { line: "#1864ab", text: "#1864ab" },
    callout: { text: "#ffffff", fill: "#1864ab" },
    branches: [
      { stroke: "#1864ab", fill: "#d0ebff" },
      { stroke: "#0b7285", fill: "#c5f6fa" },
      { stroke: "#087f5b", fill: "#c3fae8" },
      { stroke: "#364fc7", fill: "#dbe4ff" },
      { stroke: "#5f3dc4", fill: "#e5dbff" },
      { stroke: "#1971c2", fill: "#a5d8ff" },
    ],
  },
  sunset: {
    central: { text: "#ffffff", border: "#c92a2a", fill: "#c92a2a" },
    topicText: "#3b1f1f",
    summary: { text: "#3b1f1f", border: "#d9480f", fill: "#fff4e6" },
    boundary: { line: "#ffa94d", fill: "#fff4e6", title: "#3b1f1f", titleFill: "#ffd8a8" },
    relationship: { line: "#a61e4d", text: "#a61e4d" },
    callout: { text: "#ffffff", fill: "#c2255c" },
    branches: [
      { stroke: "#e8590c", fill: "#ffe8cc" },
      { stroke: "#c2255c", fill: "#ffdeeb" },
      { stroke: "#f08c00", fill: "#fff3bf" },
      { stroke: "#e03131", fill: "#ffe3e3" },
      { stroke: "#a61e4d", fill: "#fcc2d7" },
      { stroke: "#d9480f", fill: "#ffd8a8" },
    ],
  },
  forest: {
    central: { text: "#ffffff", border: "#2b8a3e", fill: "#2b8a3e" },
    topicText: "#1b2e1f",
    summary: { text: "#1b2e1f", border: "#5c940d", fill: "#f4fce3" },
    boundary: { line: "#8ce99a", fill: "#ebfbee", title: "#1b2e1f", titleFill: "#b2f2bb" },
    relationship: { line: "#5c940d", text: "#5c940d" },
    callout: { text: "#ffffff", fill: "#2b8a3e" },
    branches: [
      { stroke: "#2b8a3e", fill: "#d3f9d8" },
      { stroke: "#5c940d", fill: "#e9fac8" },
      { stroke: "#087f5b", fill: "#c3fae8" },
      { stroke: "#e67700", fill: "#fff3bf" },
      { stroke: "#7c5a2e", fill: "#f1e3d3" },
      { stroke: "#0b7285", fill: "#c5f6fa" },
    ],
  },
  monochrome: {
    central: { text: "#ffffff", border: "#212529", fill: "#212529" },
    topicText: "#212529",
    summary: { text: "#212529", border: "#495057", fill: "#ffffff" },
    boundary: { line: "#adb5bd", fill: "#f8f9fa", title: "#212529", titleFill: "#dee2e6" },
    relationship: { line: "#495057", text: "#495057" },
    callout: { text: "#ffffff", fill: "#343a40" },
    branches: [
      { stroke: "#343a40", fill: "#dee2e6" },
      { stroke: "#495057", fill: "#e9ecef" },
      { stroke: "#212529", fill: "#ced4da" },
      { stroke: "#868e96", fill: "#f1f3f5" },
    ],
  },
};

export const isPreset = (t: unknown): t is Preset => typeof t === "string" && Object.prototype.hasOwnProperty.call(PRESETS, t);

/** The theme of the map with this central topic; maps made before there were themes have the Custom one. */
export const themeIn = (root: NodeData | null | undefined): Theme => (typeof root?.theme === "string" && root.theme ? root.theme : CUSTOM_THEME);

/** The user's themes from the plugin settings; the plugin replaces them on load and whenever the settings change. */
let userThemes: UserTheme[] = [];

export function setUserThemes(t: UserTheme[]) {
  userThemes = t;
}

/** The colors of a theme; a user theme that is gone, or one from another vault, has the Classic ones. */
export const colorsOf = (theme: Theme): Colors =>
  isPreset(theme) ? PALETTES[theme] : userThemes.find((t) => t.id === theme)?.colors ?? DEFAULT_COLORS;

/** A copy of a preset's colors, to start a theme of the user's from. */
export const presetColors = (p: Preset): Colors => structuredClone(PALETTES[p]);

/** Every theme to pick from: the presets, then the user's own. */
export function themeOptions(): { id: Theme; name: string; user: boolean }[] {
  return [
    ...(Object.keys(PRESETS) as Preset[]).map((id) => ({ id, name: PRESETS[id], user: false })),
    ...userThemes.map((t) => ({ id: t.id, name: t.name, user: true })),
  ];
}

/** The theme's name; null for a user theme that is gone. */
export const themeName = (theme: Theme): string | null => (isPreset(theme) ? PRESETS[theme] : userThemes.find((t) => t.id === theme)?.name ?? null);

/** A new id for a user theme, unlike the presets' and those taken. */
export function newThemeId(taken: string[]): string {
  for (;;) {
    const id = `theme-${Math.random().toString(36).slice(2, 10)}`;
    if (!taken.includes(id)) return id;
  }
}

/** The name, or with a number after it when another theme has it already. */
export function uniqueName(name: string, taken: string[]): string {
  if (!taken.includes(name)) return name;
  for (let i = 2; ; i++) if (!taken.includes(`${name} ${i}`)) return `${name} ${i}`;
}

/**
 * Colors read from saved settings or an imported theme, over the defaults: a color that is missing or not a string
 * gets its default, so colors added in later versions get theirs too.
 */
export function mergeColors(value: unknown): Colors {
  const c = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const str = (v: unknown, d: string) => (typeof v === "string" && v.trim() ? v.trim() : d);
  const group = <T extends object>(v: unknown, d: T): T => {
    const o = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(d).map(([k, dv]) => [k, str(o[k], dv as string)])) as T;
  };
  // Before it had a text color, the relationship color was a single string for both.
  const relationship = typeof c.relationship === "string" ? { line: c.relationship, text: c.relationship } : c.relationship;
  const defaults = DEFAULT_COLORS.branches;
  const branches = Array.isArray(c.branches) ? c.branches.map((b, i) => group(b, defaults[i % defaults.length])) : [];
  return {
    central: group(c.central, DEFAULT_COLORS.central),
    topicText: str(c.topicText, DEFAULT_COLORS.topicText),
    summary: group(c.summary, DEFAULT_COLORS.summary),
    boundary: group(c.boundary, DEFAULT_COLORS.boundary),
    relationship: group(relationship, DEFAULT_COLORS.relationship),
    // Callouts with a border were pale bubbles, unreadable without it: they get the new colors.
    callout: group((c.callout as { border?: unknown } | undefined)?.border ? {} : c.callout, DEFAULT_COLORS.callout),
    branches: branches.length ? branches : structuredClone(defaults),
  };
}

const THEME_FILE = "excalidraw-mindmap-themes";

/** Themes as JSON to share, without their ids: whoever imports them gets new ones. */
export function themesToJson(themes: { name: string; colors: Colors }[]): string {
  return JSON.stringify({ type: THEME_FILE, version: 1, themes: themes.map(({ name, colors }) => ({ name, colors })) }, null, 2);
}

/**
 * The themes in exported JSON: a file of themes, a list of them or a single one, each with a name and colors.
 * Null when there are none.
 */
export function parseThemes(text: string): { name: string; colors: Colors }[] | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  const themes = (data as { themes?: unknown } | null)?.themes;
  const list: unknown[] = Array.isArray(data) ? data : Array.isArray(themes) ? themes : [data];
  const out = list
    .filter((t): t is { name?: unknown; colors: object } => !!t && typeof t === "object" && !!(t as { colors?: unknown }).colors && typeof (t as { colors?: unknown }).colors === "object")
    .map((t) => ({ name: typeof t.name === "string" && t.name.trim() ? t.name.trim() : "Imported theme", colors: mergeColors(t.colors) }));
  return out.length ? out : null;
}

/** Whether new connectors end in an arrowhead at the child; also from the plugin settings. */
let arrows = false;

export function setArrows(v: boolean) {
  arrows = v;
}

export const connectorArrowhead = () => (arrows ? "arrow" : null);

/** Structure, auto-align and theme of new maps; also from the plugin settings. */
export interface MapDefaults { structure: Structure; autoAlign: boolean; theme: Theme; }

let mapDefaults: MapDefaults = { structure: "balanced", autoAlign: true, theme: CUSTOM_THEME };


export function setMapDefaults(d: MapDefaults) {
  mapDefaults = d;
}

export const newMapDefaults = () => mapDefaults;

/** Branch colors for the i-th main topic of a map. */
export function branchColor(i: number, c: Colors): Branch {
  const b = c.branches.length ? c.branches : DEFAULT_COLORS.branches;
  return b[i % b.length];
}

export const DEFAULT_TEXT = ["Central Topic", "Main Topic", "Subtopic"];
export const SUMMARY_TEXT = "Summary";
export const BOUNDARY_TEXT = "Boundary";
export const CALLOUT_TEXT = "Callout";
export const MIN_TEXT_WIDTH = 24;

export function paddingFor(depth: number): { padX: number; padY: number } {
  if (depth === 0) return { padX: 24, padY: 14 };
  if (depth === 1) return { padX: 16, padY: 10 };
  return { padX: 12, padY: 6 };
}

export function styleFor(depth: number, branch: Branch, c: Colors): NodeStyle {
  const pad = paddingFor(depth);
  if (depth === 0)
    return { fontSize: 28, textColor: c.central.text, borderColor: c.central.border, backgroundColor: c.central.fill, strokeWidth: 2, edgeWidth: 2, ...pad };
  if (depth === 1)
    return { fontSize: 20, textColor: c.topicText, borderColor: branch.stroke, backgroundColor: branch.fill, strokeWidth: 2, edgeWidth: 2, ...pad };
  return { fontSize: 16, textColor: c.topicText, borderColor: branch.stroke, backgroundColor: "transparent", strokeWidth: 1, edgeWidth: 1, ...pad };
}

export const SUMMARY_PADDING = { padX: 16, padY: 8 };
export const TITLE_PADDING = { padX: 12, padY: 4 };
export const TITLE_FONT_SIZE = 16;
export const CALLOUT_PADDING = { padX: 10, padY: 6 };
export const CALLOUT_FONT_SIZE = 14;
export const BADGE_PADDING = { padX: 5, padY: 2 };
export const BADGE_FONT_SIZE = 12;
export const BADGE_GAP = 6; // folded topic to its badge

/** Summary topics use their own colors, whatever the branch. */
export function summaryStyle(c: Colors): NodeStyle {
  const s = c.summary;
  return { fontSize: 16, textColor: s.text, borderColor: s.border, backgroundColor: s.fill, strokeWidth: 2, edgeWidth: 2, ...SUMMARY_PADDING };
}
