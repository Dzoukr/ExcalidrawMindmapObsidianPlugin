import type { El } from "./excalidraw";
import type { LBoundary, LNode, Side } from "./layout";

// Mind map structure is stored in element customData under this key.
export const KEY = "mindmap";

// Elements hidden by a folded topic keep their own opacity and lock state here, to restore when shown again.
export const HIDDEN_KEY = "mindmapHidden";

/**
 * How the main topics are placed around the central topic: on both sides, balanced by their order
 * or each on the side it was put on, or all on one side.
 */
export type Structure = "balanced" | "free" | "right" | "left";

export const STRUCTURES: Record<Structure, string> = {
  balanced: "Balanced",
  free: "Free",
  right: "Right",
  left: "Left",
};

export interface NodeData {
  self: string; // element id at creation, a mismatch means the element is a pasted or duplicated copy
  root: string;
  parent: string | null;
  order: number;
  side?: Side; // level-1 nodes only: the side in a free map, kept while the map has another structure
  structure?: Structure; // central topic only, free when not set: maps made before there were structures
  autoAlign?: boolean; // central topic only: no topic keeps a manual position; off when not set, as in maps made before
  theme?: string; // central topic only: the colors of the map, custom (from the settings) when not set
  summary?: string[]; // summary topic: ids of the siblings it spans, the range runs from the first to the last still present
  folded?: boolean; // subtopics, summaries and boundaries are hidden
  ox?: number; // manual offset
  oy?: number;
  lx?: number; // last position placed by layout
  ly?: number;
}

export interface EdgeData {
  edge: true;
  root: string;
  parent: string;
  child: string;
}

export interface BoundaryData {
  boundary: true;
  self: string;
  root: string;
  parent: string;
  topics: string[]; // the range runs from the first to the last still present among the parent's children
  lx?: number; // frame as the layout last placed it, to tell when the user resized or moved it
  ly?: number;
  lw?: number;
  lh?: number;
}

export interface TitleData {
  boundaryTitle: true;
  self: string;
  root: string;
  boundary: string;
}

/** Relationship: a curved arrow from one topic to another, possibly of another map, with an optional label. */
export interface RelationData {
  relation: true;
  self: string;
  from: string;
  to: string;
  bend?: number; // sideways bulge as a fraction of its length, see relationPoints; the default when not set
}

/** Count of hidden topics shown next to a folded topic; selecting it unfolds the topic. */
export interface BadgeData {
  badge: true;
  self: string;
  root: string;
  node: string;
}

/** Callout: a note in a bubble right above its topic, pointed at it by a tail. One per topic, not on summaries. */
export interface CalloutData {
  callout: true;
  self: string;
  root: string;
  node: string;
}

/** The tail of a callout: a filled triangle from behind the bubble to its topic. */
export interface TailData {
  calloutTail: true;
  root: string;
  callout: string;
}

export interface HiddenState {
  opacity: number;
  locked: boolean;
  link?: string | null;
  hasTextLink?: boolean;
}

export interface MMBadge {
  el: El;
  text: El | null;
}

export interface MMCallout {
  el: El; // the bubble, a container
  text: El | null;
  tail: El | null;
}

export interface MMBoundary extends LBoundary {
  el: El;
  parent: MMNode;
  title: El | null; // container of the title text
  titleText: El | null;
}

export interface BraceData {
  brace: true;
  root: string;
  summary: string;
}

export interface MMSummary {
  node: MMNode;
  covers: string[];
}

export interface MMNode extends LNode {
  side: Side | null; // the side shown, which only a free map takes from the stored one
  el: El;
  text: El | null;
  data: NodeData;
  parent: MMNode | null;
  children: MMNode[];
  summaries: MMSummary[];
  boundaries: MMBoundary[];
  covers: string[] | null; // set on summary topics: the siblings they span
  depth: number;
}

export interface MindMap {
  root: MMNode;
  nodes: Map<string, MMNode>;
  edges: Map<string, El>; // child id -> connector
  strayEdges: El[];
  braces: Map<string, El>; // summary id -> brace
  strayBraces: El[];
  boundaries: Map<string, MMBoundary>;
  strayBoundaries: El[]; // frames and titles left without a boundary to belong to
  badges: Map<string, MMBadge>; // folded node id -> badge
  strayBadges: El[];
  callouts: Map<string, MMCallout>; // node id -> its callout
  strayCallouts: El[]; // bubbles and tails left without a topic or a bubble to belong to
}

/** The mind map data stored on the element, not yet known to be of any particular kind. */
function stored(el: El | undefined | null): Record<string, unknown> | null {
  const d = el?.customData?.[KEY];
  return d && typeof d === "object" ? (d as Record<string, unknown>) : null;
}

export function nodeData(el: El | undefined | null): NodeData | null {
  const d = stored(el);
  if (!d || d.edge || d.boundary || d.boundaryTitle || d.badge || d.relation || d.callout || d.self !== el?.id) return null;
  return d as unknown as NodeData;
}

export function edgeData(el: El | undefined | null): EdgeData | null {
  const d = stored(el);
  return d?.edge ? (d as unknown as EdgeData) : null;
}

export function boundaryData(el: El | undefined | null): BoundaryData | null {
  const d = stored(el);
  return d?.boundary === true && d.self === el?.id ? (d as unknown as BoundaryData) : null; // a title's `boundary` is its frame id
}

export function titleData(el: El | undefined | null): TitleData | null {
  const d = stored(el);
  return d?.boundaryTitle && d.self === el?.id ? (d as unknown as TitleData) : null;
}

export function relationData(el: El | undefined | null): RelationData | null {
  const d = stored(el);
  return d?.relation && d.self === el?.id ? (d as unknown as RelationData) : null;
}

export function badgeData(el: El | undefined | null): BadgeData | null {
  const d = stored(el);
  return d?.badge && d.self === el?.id ? (d as unknown as BadgeData) : null;
}

export function calloutData(el: El | undefined | null): CalloutData | null {
  const d = stored(el);
  return d?.callout && d.self === el?.id ? (d as unknown as CalloutData) : null;
}

export function tailData(el: El | undefined | null): TailData | null {
  const d = stored(el);
  return d?.calloutTail ? (d as unknown as TailData) : null;
}

/** Whether the element is a relationship label already given the label color. */
export function isRelationLabel(el: El | undefined | null): boolean {
  return !!stored(el)?.relationLabel;
}

/** Opacity, lock and link an element hidden by a folded topic had before, to restore when shown again. */
export function hiddenState(el: El | undefined | null): HiddenState | null {
  const h = el?.customData?.[HIDDEN_KEY];
  return h && typeof h === "object" ? (h as HiddenState) : null;
}

/** Root id of the map a node, boundary frame, boundary title, callout or callout tail belongs to. */
export function rootIdOf(el: El | undefined | null): string | null {
  return nodeData(el)?.root ?? boundaryData(el)?.root ?? titleData(el)?.root ?? calloutData(el)?.root ?? tailData(el)?.root ?? null;
}

export function braceData(el: El | undefined | null): BraceData | null {
  const d = stored(el);
  return d?.brace ? (d as unknown as BraceData) : null;
}

export function boundTextId(el: El): string | undefined {
  return el.boundElements?.find((b) => b.type === "text")?.id;
}

export const isStructure = (s: unknown): s is Structure => typeof s === "string" && Object.prototype.hasOwnProperty.call(STRUCTURES, s);

/** The structure of the map with this central topic; maps made before there were structures, or with one unknown to this version, are free. */
export const structureIn = (root: NodeData): Structure => (isStructure(root.structure) ? root.structure : "free");

export const structureOf = (root: MMNode): Structure => structureIn(root.data);

/** Whether the map with this central topic is auto-aligned: every topic in its automatic place, a drop only reorders. */
export const autoAligned = (root: NodeData): boolean => root.autoAlign === true;

/** Whether the main topics go on both sides of the central topic. */
export const twoSided = (s: Structure) => s === "balanced" || s === "free";

export const byOrder = (a: MMNode, b: MMNode) => a.data.order - b.data.order;

/**
 * The node's siblings in the order they are numbered in. In a balanced map that is all the main topics
 * clockwise from the top right, so on the left side the line runs bottom to top (reversed). Otherwise it is
 * the siblings on the node's side, top to bottom.
 */
export function orderLine(n: MMNode): { line: MMNode[]; reversed: boolean } {
  const p = n.parent!;
  if (!p.parent && structureOf(p) === "balanced") return { line: [...p.children].sort(byOrder), reversed: n.side === "L" };
  return { line: p.children.filter((c) => c.side === n.side), reversed: false };
}

/** Where the topics listed run in the line, first to last, for each list with any of them in it. */
export function rangesIn(line: { id: string }[], lists: string[][]): [number, number][] {
  return lists
    .map((ids) => ids.map((id) => line.findIndex((n) => n.id === id)).filter((i) => i >= 0))
    .filter((idx) => idx.length)
    .map((idx) => [Math.min(...idx), Math.max(...idx)]);
}

/**
 * How many of a balanced map's main topics go right: half, rounded up, or as near to it as keeps every range
 * (the topics of a boundary or summary) on one side.
 */
export function balancedSplit(count: number, ranges: [number, number][]): number {
  const half = Math.ceil(count / 2);
  const cuts = (k: number) => ranges.some(([from, to]) => from < k && k <= to);
  for (let d = 0; ; d++) for (const k of [half + d, half - d]) if (k >= 0 && k <= count && !cuts(k)) return k;
}

/** Resolves a selected element (node container or its text) to the mind map node element. */
export function resolveNodeElement(el: El | undefined, byId: Map<string, El>): El | null {
  if (!el) return null;
  if (el.type === "text" && el.containerId) el = byId.get(el.containerId);
  return el && !el.isDeleted && nodeData(el) ? el : null;
}

export function buildMap(elements: readonly El[], rootId: string): MindMap | null {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const rootEl = byId.get(rootId);
  const rootData = nodeData(rootEl);
  if (!rootEl || rootEl.isDeleted || !rootData || rootData.parent !== null) return null;

  const nodes = new Map<string, MMNode>();
  for (const el of elements) {
    if (el.isDeleted) continue;
    const data = nodeData(el);
    if (!data || data.root !== rootId) continue;
    if (data.parent === null && el.id !== rootId) continue;
    const tid = boundTextId(el);
    const text = tid ? byId.get(tid) : undefined;
    nodes.set(el.id, {
      id: el.id, el, data, text: text && !text.isDeleted ? text : null,
      parent: null, children: [], summaries: [], boundaries: [], covers: null, depth: 0, side: null,
    });
  }
  const root = nodes.get(rootId)!;
  const summaries: MMNode[] = [];
  for (const n of nodes.values()) {
    if (n === root) continue;
    let p = n.data.parent ? nodes.get(n.data.parent) : undefined;
    if (!p || p === n) p = root; // orphan after manual deletion: reattach to root
    n.parent = p;
    if (n.data.summary && p.id === n.data.parent) summaries.push(n);
    else p.children.push(n);
  }

  // Sides of the main topics: fixed in a one-sided map, in a balanced one the first half of the order
  // goes right and the rest left, clockwise. A free map keeps the stored sides.
  const structure = structureOf(root);
  const fixed: Side | null = structure === "right" ? "R" : structure === "left" ? "L" : null;
  const sides = new Map<string, Side>();
  if (structure === "balanced") {
    const mains = [...root.children].sort(byOrder);
    const lists = [
      ...elements.filter((e) => !e.isDeleted && boundaryData(e)?.root === rootId && boundaryData(e)?.parent === rootId).map((e) => boundaryData(e)!.topics),
      ...summaries.filter((s) => s.parent === root).map((s) => s.data.summary!),
    ];
    const half = balancedSplit(mains.length, rangesIn(mains, lists));
    mains.forEach((c, i) => sides.set(c.id, i < half ? "R" : "L"));
  }
  const sideOf = (n: MMNode): Side => fixed ?? sides.get(n.id) ?? n.data.side ?? "R";
  // Siblings on one side top to bottom: a balanced map's left side runs against the order.
  const topDown = (p: MMNode) => (a: MMNode, b: MMNode) =>
    p === root && structure === "balanced" && sideOf(a) === "L" ? b.data.order - a.data.order : a.data.order - b.data.order;

  // A summary spans the siblings (on its side) from the first to the last one it lists that still exist.
  // Without any, it stays as an ordinary topic. A summary of main topics is on the side of the first one it lists.
  for (const s of summaries) {
    const p = s.parent!;
    const listed = p === root ? s.data.summary!.map((id) => nodes.get(id)).find((c) => c?.parent === root) : undefined;
    if (listed) sides.set(s.id, sideOf(listed));
    const sibs = p.children
      .filter((c) => p !== root || sideOf(c) === sideOf(s))
      .sort(topDown(p));
    const idx = s.data.summary!.map((id) => sibs.findIndex((c) => c.id === id)).filter((i) => i >= 0);
    if (!idx.length) {
      p.children.push(s);
      continue;
    }
    s.covers = sibs.slice(Math.min(...idx), Math.max(...idx) + 1).map((c) => c.id);
    p.summaries.push({ node: s, covers: s.covers });
  }

  // Break cycles from corrupted data: anything unreachable from the root hangs off the root.
  const reached = new Set<string>();
  const walk = (n: MMNode) => {
    reached.add(n.id);
    n.children.forEach(walk);
    n.summaries.forEach((s) => walk(s.node));
  };
  walk(root);
  for (const n of nodes.values()) {
    if (reached.has(n.id)) continue;
    n.parent!.children = n.parent!.children.filter((c) => c !== n);
    n.parent!.summaries = n.parent!.summaries.filter((s) => s.node !== n);
    n.covers = null;
    n.parent = root;
    root.children.push(n);
    walk(n);
  }

  // The central topic can't be folded, and a topic with nothing under it has nothing to hide.
  const finish = (n: MMNode, depth: number, side: Side | null) => {
    n.depth = depth;
    n.side = side;
    n.folded = depth > 0 && !!n.data.folded && (n.children.length > 0 || n.summaries.length > 0);
    // Top to bottom, the right side first.
    const order = topDown(n);
    n.children.sort((a, b) => (depth > 0 || sideOf(a) === sideOf(b) ? order(a, b) : sideOf(a) === "R" ? -1 : 1));
    for (const c of n.children) finish(c, depth + 1, depth === 0 ? sideOf(c) : side);
    for (const s of n.summaries) finish(s.node, depth + 1, depth === 0 ? sideOf(s.node) : side);
  };
  finish(root, 0, null);

  const edges = new Map<string, El>();
  const strayEdges: El[] = [];
  for (const el of elements) {
    if (el.isDeleted) continue;
    const d = edgeData(el);
    if (!d || d.root !== rootId) continue;
    const child = nodes.get(d.child);
    if (child && !child.covers && child.parent?.id === d.parent && !edges.has(d.child)) edges.set(d.child, el);
    else strayEdges.push(el);
  }

  const braces = new Map<string, El>();
  const strayBraces: El[] = [];
  for (const el of elements) {
    if (el.isDeleted) continue;
    const d = braceData(el);
    if (!d || d.root !== rootId) continue;
    if (nodes.get(d.summary)?.covers && !braces.has(d.summary)) braces.set(d.summary, el);
    else strayBraces.push(el);
  }

  // A boundary encloses its parent's children (on one side) from the first to the last it lists that still exist.
  const boundaries = new Map<string, MMBoundary>();
  const strayBoundaries: El[] = [];
  for (const el of elements) {
    if (el.isDeleted) continue;
    const d = boundaryData(el);
    if (!d || d.root !== rootId) continue;
    const p = nodes.get(d.parent);
    const listed = p ? p.children.filter((c) => d.topics.includes(c.id)) : [];
    if (!p || !listed.length) {
      strayBoundaries.push(el);
      continue;
    }
    const sibs = p.children.filter((c) => c.side === listed[0].side);
    const idx = listed.map((c) => sibs.indexOf(c)).filter((i) => i >= 0);
    const b: MMBoundary = {
      id: el.id, el, parent: p, title: null, titleText: null,
      covers: sibs.slice(Math.min(...idx), Math.max(...idx) + 1).map((c) => c.id),
    };
    boundaries.set(el.id, b);
    p.boundaries.push(b);
  }
  for (const el of elements) {
    if (el.isDeleted) continue;
    const d = titleData(el);
    if (!d || d.root !== rootId) continue;
    const b = boundaries.get(d.boundary);
    if (!b || b.title) {
      strayBoundaries.push(el);
      continue;
    }
    const tid = boundTextId(el);
    const text = tid ? byId.get(tid) : undefined;
    b.title = el;
    b.titleText = text && !text.isDeleted ? text : null;
  }

  const badges = new Map<string, MMBadge>();
  const strayBadges: El[] = [];
  for (const el of elements) {
    if (el.isDeleted) continue;
    const d = badgeData(el);
    if (!d || d.root !== rootId) continue;
    if (!nodes.get(d.node)?.folded || badges.has(d.node)) {
      strayBadges.push(el);
      continue;
    }
    const tid = boundTextId(el);
    const text = tid ? byId.get(tid) : undefined;
    badges.set(d.node, { el, text: text && !text.isDeleted ? text : null });
  }

  const callouts = new Map<string, MMCallout>();
  const strayCallouts: El[] = [];
  const bubbles = new Map<string, MMCallout>(); // callout id -> callout
  for (const el of elements) {
    if (el.isDeleted) continue;
    const d = calloutData(el);
    if (!d || d.root !== rootId) continue;
    const n = nodes.get(d.node);
    if (!n || n.covers || callouts.has(d.node)) {
      strayCallouts.push(el);
      continue;
    }
    const tid = boundTextId(el);
    const text = tid ? byId.get(tid) : undefined;
    const c: MMCallout = { el, text: text && !text.isDeleted ? text : null, tail: null };
    callouts.set(d.node, c);
    bubbles.set(el.id, c);
    n.callout = el.id;
  }
  for (const el of elements) {
    if (el.isDeleted) continue;
    const d = tailData(el);
    if (!d || d.root !== rootId) continue;
    const c = bubbles.get(d.callout);
    if (!c || c.tail) strayCallouts.push(el);
    else c.tail = el;
  }
  return { root, nodes, edges, strayEdges, braces, strayBraces, boundaries, strayBoundaries, badges, strayBadges, callouts, strayCallouts };
}

/** Whether a folded ancestor (or the topic owning a summary) hides the node. */
export function isHidden(n: MMNode): boolean {
  for (let p = n.parent; p; p = p.parent) if (p.folded) return true;
  return false;
}

/** The node with its children and summaries, recursively. */
export function subtree(n: MMNode): MMNode[] {
  const out: MMNode[] = [];
  const walk = (x: MMNode) => {
    out.push(x);
    x.children.forEach(walk);
    x.summaries.forEach((s) => walk(s.node));
  };
  walk(n);
  return out;
}
