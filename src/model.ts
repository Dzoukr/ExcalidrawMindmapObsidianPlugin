import { El } from "./excalidraw";
import { LNode, Side } from "./layout";

// Mind map structure is stored in element customData under this key.
export const KEY = "mindmap";

export interface NodeData {
  self: string; // element id at creation, a mismatch means the element is a pasted or duplicated copy
  root: string;
  parent: string | null;
  order: number;
  side?: Side; // level-1 nodes only
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

export interface MMNode extends LNode {
  el: El;
  text: El | null;
  data: NodeData;
  parent: MMNode | null;
  children: MMNode[];
  depth: number;
}

export interface MindMap {
  root: MMNode;
  nodes: Map<string, MMNode>;
  edges: Map<string, El>; // child id -> connector
  strayEdges: El[];
}

export function nodeData(el: El | undefined | null): NodeData | null {
  const d = el?.customData?.[KEY];
  if (!d || d.edge || d.self !== el!.id) return null;
  return d as NodeData;
}

export function edgeData(el: El | undefined | null): EdgeData | null {
  const d = el?.customData?.[KEY];
  return d?.edge ? (d as EdgeData) : null;
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
      parent: null, children: [], depth: 0, side: null,
    });
  }
  const root = nodes.get(rootId)!;
  for (const n of nodes.values()) {
    if (n === root) continue;
    let p = n.data.parent ? nodes.get(n.data.parent) : undefined;
    if (!p || p === n) p = root; // orphan after manual deletion: reattach to root
    n.parent = p;
    p.children.push(n);
  }

  // Break cycles from corrupted data: anything unreachable from the root hangs off the root.
  const reached = new Set<string>();
  const walk = (n: MMNode) => { reached.add(n.id); n.children.forEach(walk); };
  walk(root);
  for (const n of nodes.values()) {
    if (reached.has(n.id)) continue;
    n.parent!.children = n.parent!.children.filter((c) => c !== n);
    n.parent = root;
    root.children.push(n);
    walk(n);
  }

  const finish = (n: MMNode, depth: number, side: Side | null) => {
    n.depth = depth;
    n.side = side;
    n.children.sort((a, b) => a.data.order - b.data.order);
    for (const c of n.children) finish(c, depth + 1, depth === 0 ? (c.data.side ?? "R") : side);
  };
  finish(root, 0, null);

  const edges = new Map<string, El>();
  const strayEdges: El[] = [];
  for (const el of elements) {
    if (el.isDeleted) continue;
    const d = edgeData(el);
    if (!d || d.root !== rootId) continue;
    const child = nodes.get(d.child);
    if (child && child.parent?.id === d.parent && !edges.has(d.child)) edges.set(d.child, el);
    else strayEdges.push(el);
  }
  return { root, nodes, edges, strayEdges };
}

export function subtree(n: MMNode): MMNode[] {
  const out: MMNode[] = [];
  const walk = (x: MMNode) => { out.push(x); x.children.forEach(walk); };
  walk(n);
  return out;
}
