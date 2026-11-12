// Which plugin a drawing belongs to, when more than one plugin draws its own kind of diagram in Excalidraw drawings,
// such as mind maps and C4 diagrams. The plugins need not know each other, only conventions they all follow:
//
// - The drawing's kind is in its frontmatter: `dzoukr-diagram-kind: mindmap`, `dzoukr-diagram-kind: c4` and so on.
//   A plugin writes it when it takes a drawing over. A drawing of another kind is left alone.
// - Each such plugin is in a registry on `window` while it is enabled: the map `dzoukrDiagramKinds` from its kind to
//   the version of these conventions it follows. A plugin alone in it takes every drawing without a kind, as if no
//   other were installed.
// - On a drawing nobody's yet, each offers to take it over in a row they share (see `chooser.ts`).
//
// Without a kind in its frontmatter, a drawing with a plugin's own elements in it belongs to that plugin. Any other
// drawing without a kind belongs to none: each plugin offers to take it over, and leaves its keys to Excalidraw.
//
// The conventions only change in ways the plugins following an earlier version still work with; a change they would
// not work with raises the version, for the plugins to tell.
//
// Pure: no Obsidian or Excalidraw runtime.

export const MODE_KEY = "dzoukr-diagram-kind";
export const MODE = "mindmap";
/** The version of the conventions this plugin follows. */
export const CONVENTION_VERSION = 1;
const REGISTRY = "dzoukrDiagramKinds";

/** What a plugin says of itself in the registry. */
export interface Registration {
  version: number;
}

/** Whom a drawing belongs to: this plugin, another one, or none yet. */
export type Owner = "mine" | "other" | "none";

/**
 * Whom a drawing belongs to, from the kind in its frontmatter, whether it has this plugin's own elements in it, and
 * whether this plugin is the only one of its sort enabled.
 */
export function ownerOf(kind: unknown, hasOwnElements: boolean, alone: boolean): Owner {
  if (typeof kind === "string" && kind.trim()) return kind.trim().toLowerCase() === MODE ? "mine" : "other";
  return hasOwnElements || alone ? "mine" : "none";
}

/** The registry of the plugins drawing their own kind of diagram, shared on the window. */
export function registry(host: object = window): Map<string, Registration> {
  const h = host as Record<string, unknown>;
  if (!(h[REGISTRY] instanceof Map)) h[REGISTRY] = new Map<string, Registration>();
  return h[REGISTRY] as Map<string, Registration>;
}

/** Puts this plugin in the registry while it is enabled. Returns what takes it out again. */
export function register(host: object = window): () => void {
  registry(host).set(MODE, { version: CONVENTION_VERSION });
  return () => void registry(host).delete(MODE);
}

/** Whether this plugin is the only one of its sort enabled. */
export const isAlone = (host: object = window): boolean => [...registry(host).keys()].every((m) => m === MODE);
