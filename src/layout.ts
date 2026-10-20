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
  boundaries?: LBoundary[];
  folded?: boolean; // children, summaries and boundaries are hidden and left out of the layout
  callout?: string; // id of the callout right above the node, which the size function measures
}

/** Summary topic attached to a range of the parent's children, drawn beyond a brace spanning their subtrees. */
export interface LSummary {
  node: LNode;
  covers: string[]; // ids of the consecutive children the summary spans
}

/** Boundary drawn around a range of the parent's children and their subtrees; its id also keys its title size. */
export interface LBoundary {
  id: string;
  covers: string[]; // ids of the consecutive children the boundary encloses
}

/** Brace box; its tip points away from the summarized topics, toward the summary. */
export interface Brace extends Box { side: Side; }

export interface Layout {
  boxes: Map<string, Box>;
  braces: Map<string, Brace>; // summary id -> brace
  boundaries: Map<string, { frame: Box; title: Box }>; // boundary id -> frame and the title tab on its top edge
  callouts: Map<string, Box>; // node id -> the bubble of its callout
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
export const BOUNDARY_PAD = 10; // enclosed subtrees to boundary frame
export const TITLE_INSET = 14; // frame's left edge to its title tab
export const TITLE_OVERLAP = 2; // title tab reaching down over the frame's top edge
export const MOVE_EPSILON = 0.5; // less than this from where the layout put it is not a manual move
export const CALLOUT_GAP = 16; // callout bubble to its topic, which its tail spans
export const TAIL_HALF = 7; // half the width of a callout's tail where it leaves the bubble
export const TAIL_INSET = 6; // tail reaching up behind the bubble, so it seems to grow out of it

const vGap = (depth: number) => (depth <= 1 ? V_GAP_L1 : V_GAP);

/** Index range of the covered ids among kids, when they are all there. */
function rangeIn(kids: LNode[], covers: string[]): { from: number; to: number } | null {
  const idx = covers.map((id) => kids.findIndex((k) => k.id === id));
  if (!idx.length || idx.some((i) => i < 0)) return null;
  return { from: Math.min(...idx), to: Math.max(...idx) };
}

/** Children grouped for stacking: a single child, or a run of children spanned by one or more summaries. */
interface Segment { kids: LNode[]; summaries: LSummary[]; }

function segments(kids: LNode[], summaries: LSummary[] | undefined): Segment[] {
  const ranges: { from: number; to: number; s: LSummary }[] = [];
  for (const s of summaries ?? []) {
    const r = rangeIn(kids, s.covers);
    if (r) ranges.push({ ...r, s });
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

/** The tree as shown: a folded node keeps none of its children, summaries and boundaries. */
function shown(n: LNode): LNode {
  if (n.folded) return { id: n.id, side: n.side, children: [], callout: n.callout };
  return {
    id: n.id,
    side: n.side,
    callout: n.callout,
    children: n.children.map(shown),
    summaries: n.summaries?.map((s) => ({ node: shown(s.node), covers: s.covers })),
    boundaries: n.boundaries,
  };
}

/**
 * Turns manual moves since the last layout into per-node offsets.
 * A node moved together with its parent keeps its offset, so dragging a whole subtree
 * only records the offset on the subtree root.
 */
export function updateOffsets(tree: LNode, info: (id: string) => PlacedInfo): Map<string, Vec> {
  const root = shown(tree); // hidden nodes keep their offsets
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
 * when the summary's own subtree is taller. A boundary frames its subtrees, with room kept above
 * for its title. Summaries and boundaries take in the ones within their range. A callout sits right
 * above its topic, centered on it, with room kept for it among the siblings.
 * Nodes hidden by a folded ancestor get no box.
 */
export function computeLayout(
  tree: LNode,
  size: (id: string) => Size,
  offset: (id: string) => Vec,
  rootCenter: Vec,
): Layout {
  const root = shown(tree);
  const subtreeHeight = new Map<string, number>();
  const above = new Map<string, number>(); // top of the subtree to the middle of its topic

  // Extra room above the first and below the last child a boundary encloses.
  type Margins = { top: (id: string) => number; bottom: (id: string) => number };
  const margins = (owner: LNode, kids: LNode[]): Margins => {
    const top = new Map<string, number>();
    const bottom = new Map<string, number>();
    for (const b of owner.boundaries ?? []) {
      const r = rangeIn(kids, b.covers);
      if (!r) continue;
      const first = kids[r.from].id;
      const last = kids[r.to].id;
      top.set(first, (top.get(first) ?? 0) + BOUNDARY_PAD + size(b.id).h - TITLE_OVERLAP);
      bottom.set(last, (bottom.get(last) ?? 0) + BOUNDARY_PAD);
    }
    return { top: (id) => top.get(id) ?? 0, bottom: (id) => bottom.get(id) ?? 0 };
  };
  const kidsHeight = (kids: LNode[], m: Margins, depth: number) =>
    kids.reduce((a, k) => a + m.top(k.id) + subtreeHeight.get(k.id)! + m.bottom(k.id), 0) + vGap(depth) * (kids.length - 1);
  const segmentHeight = (g: Segment, m: Margins, depth: number) =>
    Math.max(kidsHeight(g.kids, m, depth), ...g.summaries.map((s) => subtreeHeight.get(s.node.id)!));
  const stackHeight = (segs: Segment[], m: Margins, depth: number) =>
    segs.reduce((a, g) => a + segmentHeight(g, m, depth), 0) + vGap(depth) * (segs.length - 1);

  const measure = (n: LNode, depth: number): number => {
    for (const c of n.children) measure(c, depth + 1);
    for (const s of n.summaries ?? []) measure(s.node, depth + 1);
    const own = size(n.id).h;
    const lift = n.callout ? size(n.callout).h + CALLOUT_GAP : 0;
    const kids = n.children;
    const stack = kids.length ? stackHeight(segments(kids, n.summaries), margins(n, kids), depth + 1) : 0;
    // The subtree is centered on the topic, but a callout only takes room above it.
    const up = Math.max(stack / 2, own / 2 + lift);
    const h = up + Math.max(stack / 2, own / 2);
    subtreeHeight.set(n.id, h);
    above.set(n.id, up);
    return h;
  };
  for (const c of root.children) measure(c, 1);
  for (const s of root.summaries ?? []) measure(s.node, 1);

  const boxes = new Map<string, Box>();
  const braces = new Map<string, Brace>();
  const boundaries = new Map<string, { frame: Box; title: Box }>();
  const callouts = new Map<string, Box>();
  const decorations = new Map<string, Box[]>(); // summary or boundary id -> everything it draws
  const placeCallout = (n: LNode, box: Box) => {
    if (n.callout) callouts.set(n.id, calloutBox(box, size(n.callout)));
  };
  const rs = size(root.id);
  const rootBox = { x: rootCenter.x - rs.w / 2, y: rootCenter.y - rs.h / 2, w: rs.w, h: rs.h };
  boxes.set(root.id, rootBox);
  placeCallout(root, rootBox);

  const subtreeBoxes = (n: LNode): Box[] => [
    boxes.get(n.id)!,
    ...(callouts.has(n.id) ? [callouts.get(n.id)!] : []),
    ...n.children.flatMap(subtreeBoxes),
    ...(n.summaries ?? []).flatMap((s) => decorations.get(s.node.id) ?? []),
    ...(n.boundaries ?? []).flatMap((b) => decorations.get(b.id) ?? []),
  ];
  const bounds = (bs: Box[]): Box => {
    const x = Math.min(...bs.map((b) => b.x));
    const y = Math.min(...bs.map((b) => b.y));
    return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
  };

  const placeSummary = (s: LSummary, covered: Box[], side: Side, depth: number) => {
    const c = bounds(covered);
    const brace: Brace =
      side === "R"
        ? { x: c.x + c.w + BRACE_GAP, y: c.y, w: BRACE_W, h: c.h, side }
        : { x: c.x - BRACE_GAP - BRACE_W, y: c.y, w: BRACE_W, h: c.h, side };
    braces.set(s.node.id, brace);
    const sz = size(s.node.id);
    const o = offset(s.node.id);
    const x = side === "R" ? brace.x + brace.w + SUMMARY_GAP : brace.x - SUMMARY_GAP - sz.w;
    const box = { x: x + o.x, y: c.y + c.h / 2 - sz.h / 2 + o.y, w: sz.w, h: sz.h };
    boxes.set(s.node.id, box);
    placeCallout(s.node, box);
    place(box, s.node, s.node.children, side, depth + 1);
    decorations.set(s.node.id, [brace, ...subtreeBoxes(s.node)]);
  };

  const placeBoundary = (b: LBoundary, covered: Box[]) => {
    const c = bounds(covered);
    const frame = { x: c.x - BOUNDARY_PAD, y: c.y - BOUNDARY_PAD, w: c.w + 2 * BOUNDARY_PAD, h: c.h + 2 * BOUNDARY_PAD };
    const t = size(b.id);
    const title = { x: frame.x + TITLE_INSET, y: frame.y - t.h + TITLE_OVERLAP, w: t.w, h: t.h };
    boundaries.set(b.id, { frame, title });
    decorations.set(b.id, [frame, title]);
  };

  const place = (parent: Box, owner: LNode, kids: LNode[], side: Side, depth: number) => {
    if (!kids.length) return;
    const gap = vGap(depth);
    const m = margins(owner, kids);
    const segs = segments(kids, owner.summaries);
    let top = parent.y + parent.h / 2 - stackHeight(segs, m, depth) / 2;
    const hGap = depth === 1 ? ROOT_H_GAP : H_GAP;
    for (const g of segs) {
      const gh = segmentHeight(g, m, depth);
      let t = top + (gh - kidsHeight(g.kids, m, depth)) / 2;
      for (const k of g.kids) {
        t += m.top(k.id);
        const s = size(k.id);
        const sh = subtreeHeight.get(k.id)!;
        const o = offset(k.id);
        const x = side === "R" ? parent.x + parent.w + hGap : parent.x - hGap - s.w;
        const box = { x: x + o.x, y: t + above.get(k.id)! - s.h / 2 + o.y, w: s.w, h: s.h };
        boxes.set(k.id, box);
        placeCallout(k, box);
        place(box, k, k.children, side, depth + 1);
        t += sh + m.bottom(k.id) + gap;
      }
      top += gh + gap;
    }

    // Summaries and boundaries of this level, narrowest first, so each takes in those within its range.
    const fits = (covers: string[]) => !!rangeIn(kids, covers);
    type Deco = { id: string; covers: string[]; summary?: LSummary; boundary?: LBoundary };
    const decos: Deco[] = [
      ...(owner.boundaries ?? []).filter((b) => fits(b.covers)).map((b) => ({ id: b.id, covers: b.covers, boundary: b })),
      ...(owner.summaries ?? []).filter((s) => fits(s.covers)).map((s) => ({ id: s.node.id, covers: s.covers, summary: s })),
    ];
    decos.sort((a, b) => a.covers.length - b.covers.length || (a.boundary ? 0 : 1) - (b.boundary ? 0 : 1));
    const done: Deco[] = [];
    for (const d of decos) {
      const covered = [
        ...kids.filter((k) => d.covers.includes(k.id)).flatMap(subtreeBoxes),
        ...done.filter((x) => x.covers.every((id) => d.covers.includes(id))).flatMap((x) => decorations.get(x.id)!),
      ];
      if (d.summary) placeSummary(d.summary, covered, side, depth);
      else placeBoundary(d.boundary!, covered);
      done.push(d);
    }
  };
  place(rootBox, root, root.children.filter((c) => c.side !== "L"), "R", 1);
  place(rootBox, root, root.children.filter((c) => c.side === "L"), "L", 1);
  return { boxes, braces, boundaries, callouts };
}

/** The bubble of a callout of the given size, right above its topic and centered on it. */
export function calloutBox(topic: Box, s: Size): Box {
  return { x: topic.x + topic.w / 2 - s.w / 2, y: topic.y - CALLOUT_GAP - s.h, w: s.w, h: s.h };
}

/**
 * Tail of a callout: a closed triangle from behind the bubble's bottom edge, where the bubble covers it,
 * down to the middle of its topic's top edge. Its position and points relative to it.
 */
export function tailPoints(bubble: Box, topic: Box): { x: number; y: number; points: number[][] } {
  const half = Math.min(TAIL_HALF, bubble.w / 4);
  const tip = { x: topic.x + topic.w / 2, y: topic.y - 2 };
  const cx = Math.min(Math.max(tip.x, bubble.x + half), bubble.x + bubble.w - half);
  const x = cx - half;
  const y = bubble.y + bubble.h - TAIL_INSET;
  return { x, y, points: [[0, 0], [2 * half, 0], [tip.x - x, tip.y - y], [0, 0]] };
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

export const RELATION_GAP = 6; // topic to the end of a relationship
export const RELATION_BEND = 0.2; // sideways bulge of a new relationship, as a fraction of its length

/** Where the ray from the box's center toward the point leaves the box grown by the gap; the center when the point is inside. */
function exitPoint(b: Box, toward: Vec, gap: number): Vec {
  const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  const hw = b.w / 2 + gap;
  const hh = b.h / 2 + gap;
  if (Math.abs(dx) <= hw && Math.abs(dy) <= hh) return c;
  const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  return { x: c.x + dx * t, y: c.y + dy * t };
}

/**
 * Curved relationship from box a to box b, drawn through three points: its ends leave each box
 * toward the middle point, which bulges sideways from the straight line by bend times its length.
 */
export function relationPoints(a: Box, b: Box, bend: number): { start: Vec; mid: Vec; end: Vec } {
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const len = Math.hypot(cb.x - ca.x, cb.y - ca.y) || 1;
  const n = { x: -(cb.y - ca.y) / len, y: (cb.x - ca.x) / len };
  const control = { x: (ca.x + cb.x) / 2 + n.x * bend * len, y: (ca.y + cb.y) / 2 + n.y * bend * len };
  const start = exitPoint(a, control, RELATION_GAP);
  const end = exitPoint(b, control, RELATION_GAP);
  // The bulge is measured across the line between the ends, the way relationBend reads it back.
  const l = Math.hypot(end.x - start.x, end.y - start.y) || 1;
  const m = { x: -(end.y - start.y) / l, y: (end.x - start.x) / l };
  const mid = { x: (start.x + end.x) / 2 + m.x * bend * l, y: (start.y + end.y) / 2 + m.y * bend * l };
  return { start, mid, end };
}

/** The bend of a three-point relationship as drawn (points relative to its start), so a curve the user dragged is kept. */
export function relationBend(points: number[][]): number | null {
  if (points.length !== 3) return null;
  const [[x0, y0], [x1, y1], [x2, y2]] = points;
  const len = Math.hypot(x2 - x0, y2 - y0);
  if (len < 1) return null;
  const n = { x: -(y2 - y0) / len, y: (x2 - x0) / len };
  return ((x1 - (x0 + x2) / 2) * n.x + (y1 - (y0 + y2) / 2) * n.y) / len;
}

/**
 * Whether a topic dropped with its middle at the point lands on the box, to become its subtopic: inside it,
 * within the middle half of its height. Nearer its top or bottom edge, it goes between the box and its neighbour.
 */
export function dropsOnto(p: Vec, b: Box): boolean {
  return p.x >= b.x && p.x <= b.x + b.w && Math.abs(p.y - (b.y + b.h / 2)) <= b.h / 4;
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
