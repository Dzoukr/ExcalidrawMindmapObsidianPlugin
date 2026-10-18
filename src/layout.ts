// Pure layout math, no Obsidian or Excalidraw dependencies (unit-tested in test/layout.test.ts).

export type Side = "R" | "L";
export interface Vec { x: number; y: number; }
export interface Size { w: number; h: number; }
export interface Box { x: number; y: number; w: number; h: number; }

export interface LNode {
  id: string;
  side: Side | null; // null only for the root
  children: LNode[];
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
const MOVE_EPSILON = 0.5;

const vGap = (depth: number) => (depth <= 1 ? V_GAP_L1 : V_GAP);

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
  };
  const rootObs = observed(root.id);
  for (const c of root.children) visit(c, rootObs);
  return result;
}

/**
 * Horizontal mind map layout: root centered at rootCenter, level-1 branches on the right or left,
 * each subtree stacked vertically and centered on its parent. Offsets shift a node and its subtree.
 */
export function computeLayout(
  root: LNode,
  size: (id: string) => Size,
  offset: (id: string) => Vec,
  rootCenter: Vec,
): Map<string, Box> {
  const subtreeHeight = new Map<string, number>();
  const measure = (n: LNode, depth: number): number => {
    const own = size(n.id).h;
    let h = own;
    if (n.children.length) {
      const kids = n.children.reduce((a, c) => a + measure(c, depth + 1), 0) + vGap(depth + 1) * (n.children.length - 1);
      h = Math.max(own, kids);
    }
    subtreeHeight.set(n.id, h);
    return h;
  };
  for (const c of root.children) measure(c, 1);

  const boxes = new Map<string, Box>();
  const rs = size(root.id);
  const rootBox = { x: rootCenter.x - rs.w / 2, y: rootCenter.y - rs.h / 2, w: rs.w, h: rs.h };
  boxes.set(root.id, rootBox);

  const place = (parent: Box, kids: LNode[], side: Side, depth: number) => {
    if (!kids.length) return;
    const gap = vGap(depth);
    const total = kids.reduce((a, c) => a + subtreeHeight.get(c.id)!, 0) + gap * (kids.length - 1);
    let top = parent.y + parent.h / 2 - total / 2;
    const hGap = depth === 1 ? ROOT_H_GAP : H_GAP;
    for (const k of kids) {
      const s = size(k.id);
      const sh = subtreeHeight.get(k.id)!;
      const o = offset(k.id);
      const x = side === "R" ? parent.x + parent.w + hGap : parent.x - hGap - s.w;
      const box = { x: x + o.x, y: top + sh / 2 - s.h / 2 + o.y, w: s.w, h: s.h };
      boxes.set(k.id, box);
      place(box, k.children, side, depth + 1);
      top += sh + gap;
    }
  };
  place(rootBox, root.children.filter((c) => c.side !== "L"), "R", 1);
  place(rootBox, root.children.filter((c) => c.side === "L"), "L", 1);
  return boxes;
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
