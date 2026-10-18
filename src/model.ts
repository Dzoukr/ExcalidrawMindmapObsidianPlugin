import type { El } from "./excalidraw";
import type { LBoundary, LNode, Side } from "./layout";

// Mind map structure is stored in element customData under this key.
export const KEY = "mindmap";

// Elements hidden by a folded topic keep their own opacity and lock state here, to restore when shown again.
export const HIDDEN_KEY = "mindmapHidden";

export interface NodeData {
  self: string; // element id at creation, a mismatch means the element is a pasted or duplicated copy
  root: string;
  parent: string | null;
  order: number;
  side?: Side; // level-1 nodes only
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
}

/** The mind map data stored on the element, not yet known to be of any particular kind. */
function stored(el: El | undefined | null): Record<string, unknown> | null {
  const d = el?.customData?.[KEY];
  return d && typeof d === "object" ? (d as Record<string, unknown>) : null;
}

export function nodeData(el: El | undefined | null): NodeData | null {
  const d = stored(el);
  if (!d || d.edge || d.boundary || d.boundaryTitle || d.badge || d.relation || d.self !== el?.id) return null;
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

/** Whether the element is a relationship label already given the label color. */
export function isRelationLabel(el: El | undefined | null): boolean {
  return !!stored(el)?.relationLabel;
}

/** Opacity, lock and link an element hidden by a folded topic had before, to restore when shown again. */
export function hiddenState(el: El | undefined | null): HiddenState | null {
  const h = el?.customData?.[HIDDEN_KEY];
  return h && typeof h === "object" ? (h as HiddenState) : null;
}

/** Root id of the map a node, boundary frame or boundary title belongs to. */
export function rootIdOf(el: El | undefined | null): string | null {
  return nodeData(el)?.root ?? boundaryData(el)?.root ?? titleData(el)?.root ?? null;
}

export function braceData(el: El | undefined | null): BraceData | null {
  const d = stored(el);
  return d?.brace ? (d as unknown as BraceData) : null;
}

export function boundTextId(el: El): string | undefined {
  return el.boundElements?.find((b) => b.type === "text")?.id;
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

  // A summary spans the siblings (on its side) from the first to the last one it lists that still exist.
  // Without any, it stays as an ordinary topic.
  const sideOf = (n: MMNode) => n.data.side ?? "R";
  for (const s of summaries) {
    const p = s.parent!;
    const sibs = p.children
      .filter((c) => p !== root || sideOf(c) === sideOf(s))
      .sort((a, b) => a.data.order - b.data.order);
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
    n.children.sort((a, b) => a.data.order - b.data.order);
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
  return { root, nodes, edges, strayEdges, braces, strayBraces, boundaries, strayBoundaries, badges, strayBadges };
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
