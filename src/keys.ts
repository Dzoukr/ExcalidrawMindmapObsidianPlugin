/**
 * Keyboard shortcuts of the mind map, which the user can change in the settings.
 * A shortcut is a string such as "Mod+Alt+ArrowUp": the modifiers in the order Mod, Alt, Shift, then the key.
 * Mod is Ctrl, or Cmd on Mac; either one counts, as Excalidraw does.
 */

export type KeyAction =
  | "addChild" | "addSibling" | "addSiblingAbove" | "edit" | "finishEditing" | "remove" | "duplicate" | "toggleFold"
  | "selectUp" | "selectDown" | "selectLeft" | "selectRight" | "moveUp" | "moveDown" | "levelLeft" | "levelRight";

export type Shortcuts = Record<KeyAction, string[]>;

export const DEFAULT_SHORTCUTS: Shortcuts = {
  addChild: ["Tab", "Insert"],
  addSibling: ["Enter"],
  addSiblingAbove: ["Shift+Enter"],
  edit: ["F2", "Space"],
  finishEditing: ["Enter"],
  remove: ["Delete", "Backspace"],
  duplicate: ["Mod+D"],
  toggleFold: ["Mod+/"],
  selectUp: ["ArrowUp"],
  selectDown: ["ArrowDown"],
  selectLeft: ["ArrowLeft"],
  selectRight: ["ArrowRight"],
  moveUp: ["Alt+ArrowUp"],
  moveDown: ["Alt+ArrowDown"],
  levelLeft: ["Alt+ArrowLeft"],
  levelRight: ["Alt+ArrowRight"],
};

export interface ShortcutInfo {
  id: KeyAction;
  name: string;
  desc?: string;
}

/** The actions as the settings list them. */
export const SHORTCUT_GROUPS: { heading: string; actions: ShortcutInfo[] }[] = [
  {
    heading: "Topics",
    actions: [
      { id: "addChild", name: "Add child", desc: "While editing a topic too: commits the text and adds a child." },
      { id: "addSibling", name: "Add sibling below" },
      { id: "addSiblingAbove", name: "Add sibling above" },
      { id: "edit", name: "Edit text", desc: "Of the topic, or of the selected boundary's title or callout. The keys that add a sibling edit a boundary or callout too." },
      { id: "remove", name: "Delete", desc: "The selected topics with their subtopics, or the selected boundary or callout." },
      { id: "duplicate", name: "Duplicate", desc: "The selected topics with their subtopics." },
      { id: "toggleFold", name: "Collapse or expand" },
    ],
  },
  {
    heading: "Selection",
    actions: [
      { id: "selectUp", name: "Select the topic above" },
      { id: "selectDown", name: "Select the topic below" },
      { id: "selectLeft", name: "Select the topic to the left", desc: "The parent on the right side, a child on the left side." },
      { id: "selectRight", name: "Select the topic to the right", desc: "A child on the right side, the parent on the left side." },
    ],
  },
  {
    heading: "Moving",
    actions: [
      { id: "moveUp", name: "Move up among siblings", desc: "The topic, or the selected boundary with its topics." },
      { id: "moveDown", name: "Move down among siblings", desc: "The topic, or the selected boundary with its topics." },
      { id: "levelLeft", name: "Move a level to the left", desc: "Promotes the topic on the right side, demotes it on the left side." },
      { id: "levelRight", name: "Move a level to the right", desc: "Demotes the topic on the right side, promotes it on the left side." },
    ],
  },
  {
    heading: "Editing text",
    actions: [{ id: "finishEditing", name: "Finish editing", desc: "Commits the text of a topic, boundary title or callout. Keys that type a character can't be used." }],
  },
];

export const KEY_ACTIONS = Object.keys(DEFAULT_SHORTCUTS) as KeyAction[];

/** Where an action's keys work: on the selection, or in the text editor. Shortcuts conflict only within one. */
const CONTEXTS: Partial<Record<KeyAction, ("selection" | "editing")[]>> = { finishEditing: ["editing"], addChild: ["selection", "editing"] };
const contexts = (a: KeyAction) => CONTEXTS[a] ?? ["selection"];

interface Parsed {
  mod: boolean;
  alt: boolean;
  shift: boolean;
  key: string;
}

/** The parts of a shortcut, or null when it isn't one. */
export function parseShortcut(s: string): Parsed | null {
  if (typeof s !== "string" || !s) return null;
  // The last part is the key, which can itself be "+".
  const plus = s.endsWith("+");
  const parts = (plus ? s.slice(0, -1) : s).split("+");
  const key = plus ? "+" : parts.pop()!;
  if (plus && parts[parts.length - 1] === "") parts.pop();
  if (!key || parts.some((p) => !["Mod", "Alt", "Shift"].includes(p))) return null;
  return { mod: parts.includes("Mod"), alt: parts.includes("Alt"), shift: parts.includes("Shift"), key };
}

const toString = (p: Parsed) => [p.mod && "Mod", p.alt && "Alt", p.shift && "Shift", p.key].filter(Boolean).join("+");

/** A key that types itself: a character, where Shift is already part of which one it is (Shift+1 types "!"). */
const isChar = (key: string) => key.length === 1 && key.toLowerCase() === key.toUpperCase();

/** The US-layout character of a physical key, so Ctrl and Alt shortcuts work on any layout, and with Option on Mac. */
const CODE_CHARS: Record<string, string> = {
  Slash: "/", Backslash: "\\", Period: ".", Comma: ",", Semicolon: ";", Quote: "'", BracketLeft: "[", BracketRight: "]", Minus: "-", Equal: "=", Backquote: "`",
};
function codeChar(code: string): string | null {
  const m = /^(?:Key([A-Z])|Digit(\d))$/.exec(code);
  return m ? (m[1] ?? m[2]) : (CODE_CHARS[code] ?? null);
}

const IGNORED = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock", "NumLock", "ScrollLock", "OS", "Fn", "FnLock", "Hyper", "Super", "Dead", "Unidentified", "Process", "Escape"]);

export interface KeyLike {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** The key of the event as shortcuts name it: Space for " ", upper case letters. */
function eventKey(e: KeyLike): string {
  if (e.key === " ") return "Space";
  return e.key.length === 1 ? e.key.toUpperCase() : e.key;
}

/** The shortcut the event types, or null for a lone modifier or Escape, which can't be one. */
export function shortcutOf(e: KeyLike): string | null {
  if (IGNORED.has(e.key)) return null;
  const mod = e.ctrlKey || e.metaKey;
  let key = eventKey(e);
  // With Ctrl, Cmd or Alt held, some layouts and Mac's Option type another character: name the physical key.
  if ((mod || e.altKey) && (key.length !== 1 || !/^[\x21-\x7e]$/.test(key))) key = codeChar(e.code) ?? key;
  if (!key) return null;
  return toString({ mod, alt: e.altKey, shift: e.shiftKey && !isChar(key), key });
}

export function matchesShortcut(e: KeyLike, shortcut: string): boolean {
  const p = parseShortcut(shortcut);
  if (!p || (e.ctrlKey || e.metaKey) !== p.mod || e.altKey !== p.alt) return false;
  if (!isChar(p.key) && e.shiftKey !== p.shift) return false;
  return eventKey(e) === p.key || ((p.mod || p.alt) && codeChar(e.code) === p.key);
}

/** A shortcut that types text: it can't work in the text editor. */
export function typesText(shortcut: string): boolean {
  const p = parseShortcut(shortcut);
  return !!p && !p.mod && !p.alt && (p.key.length === 1 || p.key === "Space");
}

const KEY_NAMES: Record<string, string> = { ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right" };

/** The shortcut as the user reads it, such as "Ctrl+D", or "Cmd+D" on Mac. */
export function formatShortcut(shortcut: string, mac: boolean): string {
  const p = parseShortcut(shortcut);
  if (!p) return shortcut;
  return [p.mod && (mac ? "Cmd" : "Ctrl"), p.alt && (mac ? "Option" : "Alt"), p.shift && "Shift", KEY_NAMES[p.key] ?? p.key].filter(Boolean).join("+");
}

/** The action's shortcuts as the user reads them, separated by slashes, or "" when it has none. */
export function formatShortcuts(shortcuts: string[], mac: boolean): string {
  return shortcuts.map((s) => formatShortcut(s, mac)).join(" / ");
}

/** Saved shortcuts over the defaults: an action that wasn't saved, or not as a list, gets its defaults. */
export function mergeShortcuts(saved: unknown): Shortcuts {
  const out = structuredClone(DEFAULT_SHORTCUTS);
  if (!saved || typeof saved !== "object") return out;
  for (const a of KEY_ACTIONS) {
    const list: unknown = (saved as Record<string, unknown>)[a];
    if (!Array.isArray(list)) continue;
    const valid = list.map((s) => (typeof s === "string" ? parseShortcut(s) : null)).filter((p): p is Parsed => !!p).map(toString);
    out[a] = [...new Set(valid)];
  }
  return out;
}

/** The other actions the shortcut is already used by, where both would take the key. */
export function conflicts(shortcuts: Shortcuts, action: KeyAction, shortcut: string): KeyAction[] {
  const mine = contexts(action);
  return KEY_ACTIONS.filter((a) => a !== action && shortcuts[a].includes(shortcut) && contexts(a).some((c) => mine.includes(c)));
}

export const sameShortcuts = (a: string[], b: string[]) => a.length === b.length && a.every((s, i) => s === b[i]);
