// Pure layout math, no Obsidian or Excalidraw dependencies (unit-tested in test/layout.test.ts).

export type Side = "R" | "L";
export interface Vec { x: number; y: number; }
export interface Size { w: number; h: number; }
export interface Box { x: number; y: number; w: number; h: number; }

export interface LNode {
  id: string;
  side: Side | null; // null only for the root
  children: LNode[];
  summaries?: LSummary[];
}

/** Summary topic attached to a range of the parent's children, drawn beyond a brace spanning their subtrees. */
export interface LSummary {
  node: LNode;
  covers: string[]; // ids of the consecutive children the summary spans
}

/** Brace box; its tip points away from the summarized topics, toward the summary. */
export interface Brace extends Box { side: Side; }

export interface Layout {
  boxes: Map<string, Box>;
  braces: Map<string, Brace>; // summary id -> brace
}

/** Position info read from the scene, used to detect manual moves since the last layout. */
export interface PlacedInfo {
  x: number;
  y: number;
  lx?: number; // x where the layout last placed the node
  ly?: number;
  ox: number; // accumulated manual offset
  oy: number;
}

export const ROOT_H_GAP = 70;
export const H_GAP = 40;
export const V_GAP_L1 = 24;
export const V_GAP = 12;
export const BRACE_GAP = 10; // summarized subtrees to brace
export const BRACE_W = 18; // brace including its tip
export const SUMMARY_GAP = 12; // brace tip to summary topic
const MOVE_EPSILON = 0.5;

const vGap = (depth: number) => (depth <= 1 ? V_GAP_L1 : V_GAP);

/** Children grouped for stacking: a single child, or a run of children spanned by one or more summaries. */
interface Segment { kids: LNode[]; summaries: LSummary[]; }

function segments(kids: LNode[], summaries: LSummary[] | undefined): Segment[] {
  const index = new Map(kids.map((k, i) => [k.id, i]));
  const ranges: { from: number; to: number; s: LSummary }[] = [];
  for (const s of summaries ?? []) {
    const idx = s.covers.map((id) => index.get(id));
    if (!idx.length || idx.some((i) => i === undefined)) continue;
    ranges.push({ from: Math.min(...(idx as number[])), to: Math.max(...(idx as number[])), s });
  }
  ranges.sort((a, b) => a.from - b.from);
  const out: Segment[] = [];
  let i = 0;
  let r = 0;
  while (i < kids.length) {
    if (r < ranges.length && ranges[r].from === i) {
      // Overlapping ranges share one segment.
      let to = ranges[r].to;
      const ss: LSummary[] = [];
      while (r < ranges.length && ranges[r].from <= to) {
        to = Math.max(to, ranges[r].to);
        ss.push(ranges[r++].s);
      }
      out.push({ kids: kids.slice(i, to + 1), summaries: ss });
      i = to + 1;
    } else {
      out.push({ kids: [kids[i++]], summaries: [] });
    }
  }
  return out;
}

/**
 * Turns manual moves since the last layout into per-node offsets.
 * A node moved together with its parent keeps its offset, so dragging a whole subtree
 * only records the offset on the subtree root.
 */
export function updateOffsets(root: LNode, info: (id: string) => PlacedInfo): Map<string, Vec> {
  const result = new Map<string, Vec>();
  const observed = (id: string): Vec => {
    const i = info(id);
    if (i.lx === undefined || i.ly === undefined) return { x: 0, y: 0 };
    return { x: i.x - i.lx, y: i.y - i.ly };
  };
  const visit = (n: LNode, parentObs: Vec) => {
    const i = info(n.id);
    const obs = observed(n.id);
    const moved = Math.abs(obs.x) > MOVE_EPSILON || Math.abs(obs.y) > MOVE_EPSILON;
    result.set(n.id, moved ? { x: i.ox + obs.x - parentObs.x, y: i.oy + obs.y - parentObs.y } : { x: i.ox, y: i.oy });
    for (const c of n.children) visit(c, obs);
    for (const s of n.summaries ?? []) visit(s.node, obs);
  };
  const rootObs = observed(root.id);
  for (const c of root.children) visit(c, rootObs);
  for (const s of root.summaries ?? []) visit(s.node, rootObs);
  return result;
}

/**
 * Horizontal mind map layout: root centered at rootCenter, level-1 branches on the right or left,
 * each subtree stacked vertically and centered on its parent. Offsets shift a node and its subtree.
 * A summary sits beyond the summarized subtrees, centered on them, and its range gets extra room
 * when the summary's own subtree is taller.
 */
export function computeLayout(
  root: LNode,
  size: (id: string) => Size,
  offset: (id: string) => Vec,
  rootCenter: Vec,
): Layout {
  const subtreeHeight = new Map<string, number>();
  const stackHeight = (segs: Segment[], depth: number) =>
    segs.reduce((a, g) => a + segmentHeight(g, depth), 0) + vGap(depth) * (segs.length - 1);
  const segmentHeight = (g: Segment, depth: number) => {
    const kids = g.kids.reduce((a, k) => a + subtreeHeight.get(k.id)!, 0) + vGap(depth) * (g.kids.length - 1);
    return Math.max(kids, ...g.summaries.map((s) => subtreeHeight.get(s.node.id)!));
  };
  const measure = (n: LNode, depth: number): number => {
    for (const c of n.children) measure(c, depth + 1);
    for (const s of n.summaries ?? []) measure(s.node, depth + 1);
    const own = size(n.id).h;
    const h = n.children.length ? Math.max(own, stackHeight(segments(n.children, n.summaries), depth + 1)) : own;
    subtreeHeight.set(n.id, h);
    return h;
  };
  for (const c of root.children) measure(c, 1);
  for (const s of root.summaries ?? []) measure(s.node, 1);

  const boxes = new Map<string, Box>();
  const braces = new Map<string, Brace>();
  const rs = size(root.id);
  const rootBox = { x: rootCenter.x - rs.w / 2, y: rootCenter.y - rs.h / 2, w: rs.w, h: rs.h };
  boxes.set(root.id, rootBox);

  const subtreeBoxes = (n: LNode): Box[] => [
    boxes.get(n.id)!,
    ...n.children.flatMap(subtreeBoxes),
    ...(n.summaries ?? []).flatMap((s) => subtreeBoxes(s.node)),
  ];

  const placeSummary = (s: LSummary, kids: LNode[], side: Side, depth: number) => {
    const covered = kids.filter((k) => s.covers.includes(k.id)).flatMap(subtreeBoxes);
    const top = Math.min(...covered.map((b) => b.y));
    const bottom = Math.max(...covered.map((b) => b.y + b.h));
    const brace: Brace =
      side === "R"
        ? { x: Math.max(...covered.map((b) => b.x + b.w)) + BRACE_GAP, y: top, w: BRACE_W, h: bottom - top, side }
        : { x: Math.min(...covered.map((b) => b.x)) - BRACE_GAP - BRACE_W, y: top, w: BRACE_W, h: bottom - top, side };
    braces.set(s.node.id, brace);
    const sz = size(s.node.id);
    const o = offset(s.node.id);
    const x = side === "R" ? brace.x + brace.w + SUMMARY_GAP : brace.x - SUMMARY_GAP - sz.w;
    const box = { x: x + o.x, y: (top + bottom) / 2 - sz.h / 2 + o.y, w: sz.w, h: sz.h };
    boxes.set(s.node.id, box);
    place(box, s.node.children, s.node.summaries, side, depth + 1);
  };

  const place = (parent: Box, kids: LNode[], summaries: LSummary[] | undefined, side: Side, depth: number) => {
    if (!kids.length) return;
    const gap = vGap(depth);
    const segs = segments(kids, summaries);
    let top = parent.y + parent.h / 2 - stackHeight(segs, depth) / 2;
    const hGap = depth === 1 ? ROOT_H_GAP : H_GAP;
    for (const g of segs) {
      const gh = segmentHeight(g, depth);
      const inner = g.kids.reduce((a, k) => a + subtreeHeight.get(k.id)!, 0) + gap * (g.kids.length - 1);
      let t = top + (gh - inner) / 2;
      for (const k of g.kids) {
        const s = size(k.id);
        const sh = subtreeHeight.get(k.id)!;
        const o = offset(k.id);
        const x = side === "R" ? parent.x + parent.w + hGap : parent.x - hGap - s.w;
        const box = { x: x + o.x, y: t + sh / 2 - s.h / 2 + o.y, w: s.w, h: s.h };
        boxes.set(k.id, box);
        place(box, k.children, k.summaries, side, depth + 1);
        t += sh + gap;
      }
      for (const s of g.summaries) placeSummary(s, g.kids, side, depth);
      top += gh + gap;
    }
  };
  place(rootBox, root.children.filter((c) => c.side !== "L"), root.summaries, "R", 1);
  place(rootBox, root.children.filter((c) => c.side === "L"), root.summaries, "L", 1);
  return { boxes, braces };
}

/** Points of a brace polyline relative to its box, meant to be drawn as a smoothed line. */
export function bracePoints(b: Brace): number[][] {
  const r = Math.min(8, b.h / 4);
  const mid = b.w * 0.45;
  const pts = [[0, 0], [mid, r], [mid, b.h / 2 - r], [b.w, b.h / 2], [mid, b.h / 2 + r], [mid, b.h - r], [0, b.h]];
  return b.side === "R" ? pts : pts.map(([x, y]) => [b.w - x, y]);
}

/** Connector end points between a parent and a child box. */
export function edgePoints(parent: Box, child: Box, side: Side): { start: Vec; end: Vec } {
  const pcy = parent.y + parent.h / 2;
  const ccy = child.y + child.h / 2;
  return side === "R"
    ? { start: { x: parent.x + parent.w, y: pcy }, end: { x: child.x, y: ccy } }
    : { start: { x: parent.x, y: pcy }, end: { x: child.x + child.w, y: ccy } };
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Center for a new area of the given size: the free spot inside the visible rectangle closest to its center,
 * or, when the view is full, just right of everything already in the drawing.
 */
export function findFreeSpot(view: Box, obstacles: Box[], size: Size, gap: number): Vec {
  const center = { x: view.x + view.w / 2, y: view.y + view.h / 2 };
  const free = (c: Vec) => {
    const b = { x: c.x - size.w / 2 - gap, y: c.y - size.h / 2 - gap, w: size.w + 2 * gap, h: size.h + 2 * gap };
    return !obstacles.some((o) => overlaps(b, o));
  };
  if (!obstacles.length || free(center)) return center;

  const stepX = size.w / 4;
  const stepY = size.h / 4;
  const nx = Math.max(0, Math.floor((view.w - size.w) / 2 / stepX));
  const ny = Math.max(0, Math.floor((view.h - size.h) / 2 / stepY));
  const candidates: Vec[] = [];
  for (let i = -nx; i <= nx; i++)
    for (let j = -ny; j <= ny; j++) candidates.push({ x: center.x + i * stepX, y: center.y + j * stepY });
  candidates.sort((a, b) => Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y));
  const spot = candidates.find(free);
  if (spot) return spot;

  const right = Math.max(...obstacles.map((o) => o.x + o.w));
  return { x: right + gap + size.w / 2, y: center.y };
}
