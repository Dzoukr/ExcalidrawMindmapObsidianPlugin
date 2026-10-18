import { Notice } from "obsidian";
import { El, ExcalidrawView, SceneTx, getEA } from "./excalidraw";
import { Box, Brace, Side, Vec, bracePoints, computeLayout, edgePoints, findFreeSpot, updateOffsets } from "./layout";
import {
  HIDDEN_KEY, KEY, MMBadge, MMBoundary, MMNode, MindMap, NodeData, badgeData, boundTextId, boundaryData, buildMap, edgeData,
  isHidden, nodeData, resolveNodeElement, rootIdOf, subtree, titleData,
} from "./model";
import {
  BADGE_FONT_SIZE, BADGE_GAP, BADGE_PADDING, BOUNDARY_TEXT, Branch, DEFAULT_TEXT, MIN_TEXT_WIDTH, NodeStyle, SUMMARY_PADDING,
  SUMMARY_TEXT, TITLE_FONT_SIZE, TITLE_PADDING, boundaryColors, branchColor, connectorArrowhead, paddingFor, styleFor, summaryStyle,
} from "./styles";

export type Direction = "up" | "down" | "left" | "right";

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 0.01;

async function waitFor<T>(probe: () => T | null, frames: number): Promise<T | null> {
  for (let i = 0; i < frames; i++) {
    const v = probe();
    if (v) return v;
    await nextFrame();
  }
  return probe();
}

// ---------- selection ----------

/** The mind map nodes selected in the view (containers or their text); empty when anything else is selected too. */
export function selectedNodes(view: ExcalidrawView): El[] {
  const api = view.excalidrawAPI;
  if (!api) return [];
  const sel = api.getAppState().selectedElementIds ?? {};
  const ids = Object.keys(sel).filter((k) => sel[k]);
  const byId = new Map(api.getSceneElements().map((e) => [e.id, e]));
  const nodes = new Map<string, El>();
  for (const id of ids) {
    const n = resolveNodeElement(byId.get(id), byId);
    if (!n) return [];
    nodes.set(n.id, n);
  }
  return [...nodes.values()];
}

/** The single mind map node currently selected in the view (container or its text), if any. */
export function selectedNode(view: ExcalidrawView): El | null {
  const nodes = selectedNodes(view);
  return nodes.length === 1 ? nodes[0] : null;
}

/** The boundary whose frame or title (alone) is selected, if any. */
export function selectedBoundary(view: ExcalidrawView): string | null {
  const api = view.excalidrawAPI;
  if (!api) return null;
  const sel = api.getAppState().selectedElementIds ?? {};
  const byId = new Map(api.getSceneElements().map((e) => [e.id, e]));
  const found = new Set<string>();
  for (const id of Object.keys(sel).filter((k) => sel[k])) {
    let el = byId.get(id);
    if (el?.type === "text" && el.containerId) el = byId.get(el.containerId);
    const b = boundaryData(el) ? el!.id : titleData(el)?.boundary;
    if (!b) return null;
    found.add(b);
  }
  return found.size === 1 ? [...found][0] : null;
}

/** The topic whose fold badge (alone) is selected, if any. */
export function selectedBadge(view: ExcalidrawView): string | null {
  const api = view.excalidrawAPI;
  if (!api) return null;
  const sel = api.getAppState().selectedElementIds ?? {};
  const ids = Object.keys(sel).filter((k) => sel[k]);
  if (!ids.length || ids.length > 2) return null; // the badge, maybe with its text
  const byId = new Map(api.getSceneElements().map((e) => [e.id, e]));
  let found: string | null = null;
  for (const id of ids) {
    let el = byId.get(id);
    if (el?.type === "text" && el.containerId) el = byId.get(el.containerId);
    const node = badgeData(el)?.node;
    if (!node || (found && found !== node)) return null;
    found = node;
  }
  return found;
}

/** Whether a boundary title is being edited. */
export function editingTitle(view: ExcalidrawView): boolean {
  const api = view.excalidrawAPI;
  const cid = api?.getAppState().editingTextElement?.containerId;
  return !!cid && !!titleData(api!.getSceneElements().find((e) => e.id === cid));
}

/** The mind map node whose text is being edited, if any. */
export function editingNode(view: ExcalidrawView): El | null {
  const api = view.excalidrawAPI;
  const cid = api?.getAppState().editingTextElement?.containerId;
  if (!cid) return null;
  const el = api!.getSceneElements().find((e) => e.id === cid);
  return nodeData(el) ? el! : null;
}

function select(view: ExcalidrawView, id: string) {
  const ea = getEA(view);
  ea?.selectElementsInView([id]);
  ea?.destroy?.();
  ensureVisible(view, id);
}

function ensureVisible(view: ExcalidrawView, id: string) {
  const api = view.excalidrawAPI!;
  const el = api.getSceneElements().find((e) => e.id === id);
  if (!el) return;
  const st = api.getAppState();
  const z = st.zoom?.value ?? 1;
  const m = 60 / z; // margin in scene units
  // Visible scene rectangle is [-scrollX, -scrollX + width / z] horizontally, same for y.
  const scroll = (pos: number, size: number, scrollPos: number, viewSize: number) => {
    if (pos - m < -scrollPos) return -(pos - m);
    if (pos + size + m > -scrollPos + viewSize / z) return -(pos + size + m - viewSize / z);
    return scrollPos;
  };
  const scrollX = scroll(el.x, el.width, st.scrollX, st.width);
  const scrollY = scroll(el.y, el.height, st.scrollY, st.height);
  if (scrollX !== st.scrollX || scrollY !== st.scrollY) api.updateScene({ appState: { scrollX, scrollY }, captureUpdate: "NEVER" });
}

// ---------- text editing ----------

/** Starts Excalidraw's in-place text editor on the selected node by replaying the Enter key Excalidraw itself handles. */
export async function startEditing(view: ExcalidrawView, selectAll: boolean) {
  const host = view.contentEl.querySelector<HTMLElement>(".excalidraw");
  if (!host) return;
  host.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true, cancelable: true }));
  const ta = await waitFor(() => view.contentEl.querySelector<HTMLTextAreaElement>("textarea.excalidraw-wysiwyg"), 30);
  if (ta && selectAll) {
    ta.focus();
    ta.select();
  }
}

/** Finishes text editing the way Escape does in Excalidraw: commits the text and keeps the node selected. */
export function commitEditing(view: ExcalidrawView): boolean {
  const ta = view.contentEl.querySelector<HTMLTextAreaElement>("textarea.excalidraw-wysiwyg");
  if (!ta) return false;
  ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
  return true;
}

async function focusNode(view: ExcalidrawView, id: string, edit: boolean) {
  await nextFrame();
  select(view, id);
  if (!edit) return;
  await nextFrame();
  await startEditing(view, true);
}

// ---------- element construction ----------

interface NewNode {
  depth: number;
  branch: Branch;
  style?: NodeStyle; // instead of the depth and branch style
  text?: string;
  data: Omit<NodeData, "self">;
  at: Vec;
  fontFamily: number;
  roughness: number;
}

function createNode(tx: SceneTx, ea: any, n: NewNode): string {
  const st = n.style ?? styleFor(n.depth, n.branch);
  ea.clear();
  Object.assign(ea.style, {
    strokeColor: st.textColor,
    backgroundColor: st.backgroundColor,
    fillStyle: "solid",
    strokeWidth: st.strokeWidth,
    strokeStyle: "solid",
    roughness: n.roughness,
    roundness: { type: 3 },
    opacity: 100,
    angle: 0,
    fontFamily: n.fontFamily,
    fontSize: st.fontSize,
    textAlign: "center",
    verticalAlign: "middle",
  });
  const id: string = ea.addText(n.at.x, n.at.y, n.text ?? DEFAULT_TEXT[Math.min(n.depth, 2)], {
    box: true,
    boxPadding: st.padX,
    boxStrokeColor: st.borderColor,
    textAlign: "center",
    textVerticalAlign: "middle",
  });
  for (const el of ea.getElements() as El[]) {
    if (el.id === id) el.customData = { ...(el.customData ?? {}), [KEY]: { ...n.data, self: id, root: n.data.root || id } };
    tx.add(el);
  }
  ea.clear();
  return id;
}

function addBound(tx: SceneTx, elId: string, arrowId: string) {
  const el = tx.get(elId);
  if (!el || el.boundElements?.some((b) => b.id === arrowId)) return;
  tx.patch(elId, { boundElements: [...(el.boundElements ?? []), { type: "arrow", id: arrowId }] });
}

function removeBound(tx: SceneTx, elId: string | undefined, arrowId: string) {
  const el = elId ? tx.get(elId) : undefined;
  if (!el?.boundElements?.some((b) => b.id === arrowId)) return;
  tx.patch(el.id, { boundElements: el.boundElements.filter((b) => b.id !== arrowId) });
}

function removeEdge(tx: SceneTx, edge: El) {
  tx.delete(edge.id);
  removeBound(tx, edge.startBinding?.elementId, edge.id);
  removeBound(tx, edge.endBinding?.elementId, edge.id);
}

function createEdge(tx: SceneTx, ea: any, rootId: string, n: MMNode, start: Vec, end: Vec) {
  const parent = n.parent!;
  const side = n.side as Side;
  ea.clear();
  Object.assign(ea.style, {
    strokeColor: n.el.strokeColor,
    strokeWidth: n.depth === 1 ? 2 : 1.5,
    strokeStyle: "solid",
    roughness: n.el.roughness,
    roundness: null,
    opacity: 100,
  });
  const id: string = ea.addArrow(
    [[start.x, start.y], [end.x, end.y]],
    {
      startArrowHead: null,
      endArrowHead: connectorArrowhead(),
      startObjectId: parent.id,
      endObjectId: n.id,
      startFixedPoint: side === "R" ? [1, 0.5] : [0, 0.5],
      endFixedPoint: side === "R" ? [0, 0.5] : [1, 0.5],
    },
  );
  const el: El = ea.getElement(id);
  el.customData = { [KEY]: { edge: true, root: rootId, parent: parent.id, child: n.id } };
  tx.add(el);
  addBound(tx, parent.id, id);
  addBound(tx, n.id, id);
  ea.clear();
}

function createBrace(tx: SceneTx, ea: any, rootId: string, summary: MMNode, b: Brace) {
  ea.clear();
  Object.assign(ea.style, {
    strokeColor: summary.el.strokeColor,
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: summary.el.roughness,
    roundness: { type: 2 }, // smooth curve through the points
    opacity: 100,
  });
  const id: string = ea.addLine(bracePoints(b).map(([x, y]) => [b.x + x, b.y + y]));
  const el: El = ea.getElement(id);
  el.customData = { [KEY]: { brace: true, root: rootId, summary: summary.id } };
  tx.add(el);
  ea.clear();
}

/** Title tab of a boundary: a container with bound text, not yet added to the scene. */
function createTitle(ea: any, rootId: string, boundaryId: string, at: Vec, roughness: number, fontFamily: number): El[] {
  const c = boundaryColors();
  ea.clear();
  Object.assign(ea.style, {
    strokeColor: c.title,
    backgroundColor: c.titleFill,
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness,
    roundness: { type: 3 },
    opacity: 100,
    angle: 0,
    fontFamily,
    fontSize: TITLE_FONT_SIZE,
    textAlign: "center",
    verticalAlign: "middle",
  });
  const id: string = ea.addText(at.x, at.y, BOUNDARY_TEXT, {
    box: true,
    boxPadding: TITLE_PADDING.padX,
    boxStrokeColor: c.titleFill,
    textAlign: "center",
    textVerticalAlign: "middle",
  });
  const els = ea.getElements() as El[];
  for (const el of els) if (el.id === id) el.customData = { [KEY]: { boundaryTitle: true, self: id, root: rootId, boundary: boundaryId } };
  // Container before its text.
  els.sort((a, b) => (a.type === "text" ? 1 : 0) - (b.type === "text" ? 1 : 0));
  ea.clear();
  return els;
}

/** Boundary frame with its title, not yet added to the scene. */
function createBoundary(ea: any, rootId: string, parent: MMNode, covers: MMNode[]): El[] {
  const c = boundaryColors();
  const first = covers[0];
  ea.clear();
  Object.assign(ea.style, {
    strokeColor: c.line,
    backgroundColor: c.fill,
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "dashed",
    roughness: first.el.roughness,
    roundness: { type: 3 },
    opacity: 100,
    angle: 0,
  });
  const id: string = ea.addRect(first.el.x, first.el.y, first.el.width, first.el.height);
  const frame: El = ea.getElement(id);
  frame.customData = { [KEY]: { boundary: true, self: id, root: rootId, parent: parent.id, topics: covers.map((n) => n.id) } };
  ea.clear();
  const font = first.text?.fontFamily ?? 1;
  return [frame, ...createTitle(ea, rootId, id, { x: first.el.x, y: first.el.y - 30 }, first.el.roughness, font)];
}

/** Fold badge of a topic: a circle with the count of hidden topics, added to the scene. */
function createBadge(tx: SceneTx, ea: any, rootId: string, n: MMNode, count: string): [El, El] {
  ea.clear();
  Object.assign(ea.style, {
    strokeColor: "#ffffff",
    backgroundColor: n.el.strokeColor,
    fillStyle: "solid",
    strokeWidth: 1,
    strokeStyle: "solid",
    roughness: n.el.roughness,
    roundness: null,
    opacity: 100,
    angle: 0,
    fontFamily: n.text?.fontFamily ?? 1,
    fontSize: BADGE_FONT_SIZE,
    textAlign: "center",
    verticalAlign: "middle",
  });
  const id: string = ea.addText(n.el.x + n.el.width, n.el.y, count, {
    box: "ellipse",
    boxPadding: BADGE_PADDING.padX,
    boxStrokeColor: n.el.strokeColor,
    textAlign: "center",
    textVerticalAlign: "middle",
  });
  const els = ea.getElements() as El[];
  for (const el of els) if (el.id === id) el.customData = { [KEY]: { badge: true, self: id, root: rootId, node: n.id } };
  els.sort((a, b) => (a.type === "text" ? 1 : 0) - (b.type === "text" ? 1 : 0));
  els.forEach((el) => tx.add(el));
  ea.clear();
  return [els[0], els[1]];
}

/** Hides an element, invisible and locked, keeping its own opacity and lock to restore, or shows it again. */
function setHidden(tx: SceneTx, id: string, hidden: boolean) {
  const el = tx.get(id);
  if (!el) return;
  const saved = el.customData?.[HIDDEN_KEY];
  if (hidden) {
    if (saved && el.opacity === 0 && el.locked) return;
    const keep = saved ?? { opacity: el.opacity ?? 100, locked: !!el.locked };
    tx.patch(id, { opacity: 0, locked: true, customData: { ...el.customData, [HIDDEN_KEY]: keep } });
  } else if (saved) {
    const { [HIDDEN_KEY]: _, ...rest } = el.customData!;
    tx.patch(id, { opacity: saved.opacity, locked: saved.locked, customData: rest });
  }
}

/** Deletes the element with any text bound to it. */
function deleteWithText(tx: SceneTx, el: El) {
  tx.delete(el.id);
  const tid = boundTextId(el);
  if (tid) tx.delete(tid);
}

function deleteBoundaryEls(tx: SceneTx, b: MMBoundary) {
  deleteWithText(tx, b.el);
  if (b.title) deleteWithText(tx, b.title);
}

// ---------- layout ----------

interface NodeSize { w: number; h: number; tw: number; th: number; }

const padOf = (n: MMNode) => (n.data.summary ? SUMMARY_PADDING : paddingFor(n.depth));

function measureBox(ea: any, text: El | null, pad: { padX: number; padY: number }): NodeSize {
  let tw = MIN_TEXT_WIDTH;
  let th = 20;
  if (text) {
    ea.style.fontFamily = text.fontFamily;
    ea.style.fontSize = text.fontSize;
    const raw: string = text.originalText ?? text.text ?? "";
    const m = ea.measureText(raw.length ? raw : " ");
    tw = Math.max(MIN_TEXT_WIDTH, Math.ceil(m.width));
    th = Math.ceil(m.height);
  }
  return { w: tw + 2 * pad.padX, h: th + 2 * pad.padY, tw, th };
}

function textPosition(text: El, box: Box, s: NodeSize, pad: { padX: number; padY: number }): Vec {
  const x =
    text.textAlign === "left" ? box.x + pad.padX
    : text.textAlign === "right" ? box.x + box.w - pad.padX - s.tw
    : box.x + (box.w - s.tw) / 2;
  const y =
    text.verticalAlign === "top" ? box.y + pad.padY
    : text.verticalAlign === "bottom" ? box.y + box.h - pad.padY - s.th
    : box.y + (box.h - s.th) / 2;
  return { x, y };
}

/** Moves and sizes a container and its bound text to the box. */
function placeBox(tx: SceneTx, el: El, text: El | null, b: Box, s: NodeSize, pad: { padX: number; padY: number }, patch: Partial<El> = {}) {
  const geomChanged = !near(el.x, b.x) || !near(el.y, b.y) || !near(el.width, b.w) || !near(el.height, b.h);
  if (geomChanged || Object.keys(patch).length) tx.patch(el.id, { x: b.x, y: b.y, width: b.w, height: b.h, ...patch });
  if (!text) return;
  const p = textPosition(text, b, s, pad);
  const raw = text.originalText ?? text.text;
  if (!near(text.x, p.x) || !near(text.y, p.y) || !near(text.width, s.tw) || !near(text.height, s.th) || text.text !== raw)
    tx.patch(text.id, { x: p.x, y: p.y, width: s.tw, height: s.th, text: raw });
}

const sameData = (a: NodeData, b: NodeData) =>
  a.parent === b.parent && a.side === b.side && a.order === b.order &&
  near(a.lx, b.lx!) && near(a.ly, b.ly!) && near(a.ox ?? 0, b.ox!) && near(a.oy ?? 0, b.oy!);

/** Sizes nodes to their text, positions the whole map and repairs connectors, all inside the transaction. */
function layoutMap(tx: SceneTx, ea: any, rootId: string): MindMap | null {
  const map = buildMap(tx.live(), rootId);
  if (!map) return null;

  // A boundary whose title was deleted by hand gets a new one, right above its frame.
  for (const b of map.boundaries.values()) {
    if (b.title) continue;
    const first = map.nodes.get(b.covers[0])!;
    const els = createTitle(ea, rootId, b.id, { x: b.el.x, y: b.el.y - 30 }, b.el.roughness, first.text?.fontFamily ?? 1);
    tx.insert(els, tx.indexOf(b.id) + 1);
    [b.title, b.titleText] = els;
  }

  const sizes = new Map<string, NodeSize>();
  for (const n of map.nodes.values()) sizes.set(n.id, measureBox(ea, n.text, padOf(n)));
  for (const b of map.boundaries.values()) sizes.set(b.id, measureBox(ea, b.titleText, TITLE_PADDING));

  const offsets = updateOffsets(map.root, (id) => {
    const n = map.nodes.get(id)!;
    return { x: n.el.x, y: n.el.y, lx: n.data.lx, ly: n.data.ly, ox: n.data.ox ?? 0, oy: n.data.oy ?? 0 };
  });
  const r = map.root.el;
  const { boxes, braces, boundaries } = computeLayout(
    map.root,
    (id) => sizes.get(id)!,
    (id) => offsets.get(id) ?? { x: 0, y: 0 },
    { x: r.x + r.width / 2, y: r.y + r.height / 2 },
  );

  for (const n of map.nodes.values()) {
    const b = boxes.get(n.id);
    if (!b) continue; // hidden by a folded topic, stays where it was
    const s = sizes.get(n.id)!;
    const o = offsets.get(n.id) ?? { x: 0, y: 0 };
    const data: NodeData = { ...n.data, parent: n.parent?.id ?? null, lx: b.x, ly: b.y, ox: o.x, oy: o.y };
    if (n.depth === 1) data.side = n.side!;
    placeBox(tx, n.el, n.text, b, s, padOf(n), sameData(n.data, data) ? {} : { customData: { ...n.el.customData, [KEY]: data } });
  }

  for (const [id, { frame, title }] of boundaries) {
    const b = map.boundaries.get(id)!;
    placeBox(tx, b.el, null, frame, sizes.get(id)!, TITLE_PADDING);
    placeBox(tx, b.title!, b.titleText, title, sizes.get(id)!, TITLE_PADDING);
  }
  for (const el of map.strayBoundaries) deleteWithText(tx, el);

  for (const n of map.nodes.values()) {
    if (!n.parent || n.covers || !boxes.has(n.id)) continue;
    const { start, end } = edgePoints(boxes.get(n.parent.id)!, boxes.get(n.id)!, n.side as Side);
    const edge = map.edges.get(n.id);
    if (!edge) {
      createEdge(tx, ea, rootId, n, start, end);
      continue;
    }
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const pts = edge.points as number[][] | undefined;
    const same = near(edge.x, start.x) && near(edge.y, start.y) && pts?.length === 2 && near(pts[1][0], dx) && near(pts[1][1], dy);
    if (!same)
      tx.patch(edge.id, { x: start.x, y: start.y, points: [[0, 0], [dx, dy]], width: Math.abs(dx), height: Math.abs(dy) });
  }
  for (const e of map.strayEdges) removeEdge(tx, e);

  for (const [id, b] of braces) {
    const brace = map.braces.get(id);
    if (!brace) {
      createBrace(tx, ea, rootId, map.nodes.get(id)!, b);
      continue;
    }
    const pts = bracePoints(b);
    const cur = brace.points as number[][] | undefined;
    const same = near(brace.x, b.x) && near(brace.y, b.y) && cur?.length === pts.length &&
      pts.every((p, i) => near(cur[i][0], p[0]) && near(cur[i][1], p[1]));
    if (!same) tx.patch(brace.id, { x: b.x, y: b.y, points: pts, width: b.w, height: b.h });
  }
  for (const e of map.strayBraces) tx.delete(e.id);

  for (const n of map.nodes.values()) {
    const box = boxes.get(n.id);
    const badge = map.badges.get(n.id);
    if (n.folded && box) placeBadge(tx, ea, rootId, n, box, badge);
    else if (badge) deleteWithText(tx, badge.el);
  }
  for (const el of map.strayBadges) deleteWithText(tx, el);

  // Everything of a hidden topic turns invisible and locked, and visible again once shown.
  for (const n of map.nodes.values()) {
    const hidden = !boxes.has(n.id);
    for (const el of [n.el, n.text, map.edges.get(n.id), map.braces.get(n.id)]) if (el) setHidden(tx, el.id, hidden);
    for (const b of n.boundaries) {
      const h = !boundaries.has(b.id);
      for (const el of [b.el, b.title, b.titleText]) if (el) setHidden(tx, el.id, h);
    }
  }
  return map;
}

/** Puts the badge with the count of hidden topics just outside the folded topic, creating or updating it. */
function placeBadge(tx: SceneTx, ea: any, rootId: string, n: MMNode, box: Box, badge: MMBadge | undefined) {
  const count = String(subtree(n).length - 1);
  let el = badge?.el;
  let text = badge?.text ?? null;
  if (!el || !text) {
    if (el) deleteWithText(tx, el);
    [el, text] = createBadge(tx, ea, rootId, n, count);
  } else if (text.originalText !== count) {
    tx.patch(text.id, { text: count, originalText: count });
    text = tx.get(text.id)!;
  }
  const s = measureBox(ea, text, BADGE_PADDING);
  const w = Math.max(s.w, s.h);
  const x = n.side === "L" ? box.x - BADGE_GAP - w : box.x + box.w + BADGE_GAP;
  placeBox(tx, el, text, { x, y: box.y + box.h / 2 - s.h / 2, w, h: s.h }, s, BADGE_PADDING);
}

/** Runs a mind map mutation in one transaction and one undo step. */
function run<T>(view: ExcalidrawView, fn: (tx: SceneTx, ea: any) => T): T | null {
  if (!view.excalidrawAPI) return null;
  const ea = getEA(view);
  if (!ea) {
    new Notice("Excalidraw plugin is not available.");
    return null;
  }
  try {
    const tx = new SceneTx(view);
    const result = fn(tx, ea);
    tx.commit();
    return result;
  } finally {
    ea.destroy?.();
  }
}

function mapOf(tx: SceneTx, id: string): { map: MindMap; node: MMNode } | null {
  const d = nodeData(tx.get(id));
  if (!d) return null;
  const map = buildMap(tx.live(), d.root);
  const node = map?.nodes.get(id);
  return map && node ? { map, node } : null;
}

const branchOf = (n: MMNode): Branch => ({ stroke: n.el.strokeColor, fill: n.el.backgroundColor });

// ---------- operations ----------

/** Scene-space bounding box of an element; lines and arrows span their points rather than x/y/width/height. */
function boundsOf(el: El): Box {
  const pts = el.points as number[][] | undefined;
  if (!pts?.length) return { x: el.x, y: el.y, w: el.width, h: el.height };
  const xs = pts.map((p) => el.x + p[0]);
  const ys = pts.map((p) => el.y + p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

// Room kept free around a new central topic so its first branches don't land on existing content.
const NEW_MAP_AREA = { w: 480, h: 160 };
const NEW_MAP_GAP = 40;

export async function newMap(view: ExcalidrawView) {
  const id = run(view, (tx, ea) => {
    const st = tx.api.getAppState();
    const z = st.zoom?.value ?? 1;
    const visible: Box = { x: -st.scrollX, y: -st.scrollY, w: st.width / z, h: st.height / z };
    const obstacles = tx.live().filter((e) => !e.customData?.[HIDDEN_KEY]).map(boundsOf);
    const c = findFreeSpot(visible, obstacles, NEW_MAP_AREA, NEW_MAP_GAP);
    const id = createNode(tx, ea, {
      depth: 0,
      branch: branchColor(0),
      data: { root: "", parent: null, order: 0 },
      at: { x: c.x - 90, y: c.y - 30 },
      fontFamily: st.currentItemFontFamily,
      roughness: st.currentItemRoughness,
    });
    layoutMap(tx, ea, id);
    return id;
  });
  if (id) await focusNode(view, id, true);
}

export async function addChild(view: ExcalidrawView, parentId: string) {
  const id = run(view, (tx, ea) => {
    const found = mapOf(tx, parentId);
    if (!found) return null;
    const { map, node } = found;
    setFolded(tx, node, false); // like XMind, a new subtopic unfolds the topic
    let side: Side | undefined;
    let branch: Branch;
    if (node.depth === 0) {
      const right = node.children.filter((c) => c.side === "R").length;
      side = right <= node.children.length - right ? "R" : "L";
      branch = branchColor(node.children.length);
    } else {
      // A summary's subtopics take the branch color of the topics it spans.
      branch = branchOf(node.covers ? map.nodes.get(node.covers[0])! : node);
    }
    const order = node.children.length ? Math.max(...node.children.map((c) => c.data.order)) + 1 : 0;
    const id = createNode(tx, ea, {
      depth: node.depth + 1,
      branch,
      data: { root: map.root.id, parent: node.id, order, ...(side ? { side } : {}) },
      at: { x: node.el.x + node.el.width + 40, y: node.el.y },
      fontFamily: node.text?.fontFamily ?? tx.api.getAppState().currentItemFontFamily,
      roughness: node.el.roughness,
    });
    layoutMap(tx, ea, map.root.id);
    return id;
  });
  if (id) await focusNode(view, id, true);
}

export async function addSibling(view: ExcalidrawView, nodeId: string, above: boolean) {
  const d = nodeData(view.excalidrawAPI?.getSceneElements().find((e) => e.id === nodeId));
  if (!d) return;
  if (d.parent === null) return addChild(view, nodeId); // the central topic has no siblings

  const id = run(view, (tx, ea) => {
    const found = mapOf(tx, nodeId);
    if (!found?.node.parent || found.node.covers) return null; // summaries have no siblings
    const { map, node } = found;
    const parent = node.parent!;
    const sibs = parent.children.filter((c) => c.side === node.side);
    const i = sibs.indexOf(node);
    const neighbour = above ? sibs[i - 1] : sibs[i + 1];
    const order = neighbour ? (node.data.order + neighbour.data.order) / 2 : node.data.order + (above ? -1 : 1);
    const id = createNode(tx, ea, {
      depth: node.depth,
      branch: node.depth === 1 ? branchColor(parent.children.length) : branchOf(node),
      data: { root: map.root.id, parent: parent.id, order, ...(node.depth === 1 ? { side: node.side as Side } : {}) },
      at: { x: node.el.x, y: node.el.y + node.el.height + 10 },
      fontFamily: node.text?.fontFamily ?? tx.api.getAppState().currentItemFontFamily,
      roughness: node.el.roughness,
    });
    // A sibling of a summarized topic joins its summary, even past either end of the range.
    for (const s of parent.summaries) {
      if (!s.covers.includes(node.id)) continue;
      tx.patch(s.node.id, { customData: { ...s.node.el.customData, [KEY]: { ...s.node.data, summary: [...s.covers, id] } } });
    }
    for (const b of parent.boundaries) {
      if (!b.covers.includes(node.id)) continue;
      tx.patch(b.id, { customData: { ...b.el.customData, [KEY]: { ...boundaryData(b.el)!, topics: [...b.covers, id] } } });
    }
    layoutMap(tx, ea, map.root.id);
    return id;
  });
  if (id) await focusNode(view, id, true);
}

function deleteSubtree(tx: SceneTx, map: MindMap, node: MMNode) {
  for (const x of subtree(node)) {
    tx.delete(x.id);
    if (x.text) tx.delete(x.text.id);
    const edge = map.edges.get(x.id);
    if (edge) removeEdge(tx, edge);
    const brace = map.braces.get(x.id);
    if (brace) tx.delete(brace.id);
    for (const b of x.boundaries) deleteBoundaryEls(tx, b);
    const badge = map.badges.get(x.id);
    if (badge) deleteWithText(tx, badge.el);
    // Unbind other arrows that pointed at the deleted node.
    for (const b of x.el.boundElements ?? []) {
      const a = tx.get(b.id);
      if (b.type !== "arrow" || !a || a.isDeleted || edgeData(a)) continue;
      const p: Partial<El> = {};
      if (a.startBinding?.elementId === x.id) p.startBinding = null;
      if (a.endBinding?.elementId === x.id) p.endBinding = null;
      tx.patch(a.id, p);
    }
  }
}

/** Deletes the node with its subtopics; the central topic only when allowRoot, taking the whole map with it. */
export async function deleteNode(view: ExcalidrawView, nodeId: string, allowRoot: boolean) {
  const next = run(view, (tx, ea) => {
    const found = mapOf(tx, nodeId);
    if (!found) return null;
    const { map, node } = found;
    if (!node.parent) {
      if (!allowRoot) {
        new Notice("Deleting the central topic is disabled. Enable it in the Excalidraw Mind Map settings.");
        return null;
      }
      deleteSubtree(tx, map, node);
      for (const e of map.strayEdges) removeEdge(tx, e);
      for (const e of map.strayBraces) tx.delete(e.id);
      for (const e of map.strayBoundaries) deleteWithText(tx, e);
      for (const e of map.strayBadges) deleteWithText(tx, e);
      tx.api.updateScene({ appState: { selectedElementIds: {} }, captureUpdate: "NEVER" });
      return null;
    }
    const parent = node.parent;
    let next: MMNode;
    if (node.covers) {
      next = map.nodes.get(node.covers[0])!;
    } else {
      const sibs = parent.children.filter((c) => c.side === node.side);
      const i = sibs.indexOf(node);
      next = sibs[i + 1] ?? sibs[i - 1] ?? parent;
    }
    const gone = new Set(subtree(node).map((x) => x.id));
    deleteSubtree(tx, map, node);
    // Like XMind, a summary goes once nothing is left for it to span.
    for (const s of parent.summaries)
      if (s.node !== node && s.covers.every((id) => gone.has(id))) deleteSubtree(tx, map, s.node);
    for (const b of parent.boundaries) if (b.covers.every((id) => gone.has(id))) deleteBoundaryEls(tx, b);
    layoutMap(tx, ea, map.root.id);
    return next.id;
  });
  if (next) await focusNode(view, next, false);
}

/** Moves the node one position up or down among its siblings on the same side, like Alt+Up/Down in XMind. */
export async function moveNode(view: ExcalidrawView, nodeId: string, up: boolean) {
  const moved = run(view, (tx, ea) => {
    const found = mapOf(tx, nodeId);
    if (!found?.node.parent || found.node.covers) return false;
    const { map, node } = found;
    const sibs = node.parent!.children.filter((c) => c.side === node.side);
    const i = sibs.indexOf(node);
    const j = up ? i - 1 : i + 1;
    if (j < 0 || j >= sibs.length) return false;
    [sibs[i], sibs[j]] = [sibs[j], sibs[i]];
    // Renumber the side so equal or fractional orders can't keep the swap from taking effect.
    sibs.forEach((s, k) => {
      if (s.data.order !== k) tx.patch(s.id, { customData: { ...s.el.customData, [KEY]: { ...s.data, order: k } } });
    });
    layoutMap(tx, ea, map.root.id);
    return true;
  });
  if (moved) await focusNode(view, nodeId, false);
}

/**
 * Whether the nodes can get a summary or a boundary: one or more siblings on the same side,
 * not the central topic or a summary.
 */
export function areSiblingTopics(nodes: El[]): boolean {
  const ds = nodes.map(nodeData);
  const first = ds[0];
  if (!first || ds.some((d) => !d || d.parent === null || d.summary)) return false;
  return ds.every((d) => d!.root === first.root && d!.parent === first.parent && (d!.side ?? "R") === (first.side ?? "R"));
}

/** Adds a summary spanning the given sibling topics and everything between them, like XMind's Summary. */
export async function addSummary(view: ExcalidrawView, nodeIds: string[]) {
  const id = run(view, (tx, ea) => {
    const found = nodeIds.length ? mapOf(tx, nodeIds[0]) : null;
    if (!found) return null;
    const { map, node: first } = found;
    const parent = first.parent;
    const nodes = nodeIds.map((id) => map.nodes.get(id));
    if (!parent || nodes.some((n) => !n || n.parent !== parent || n.covers || n.side !== first.side)) {
      new Notice("Select one or more sibling topics to summarize.");
      return null;
    }
    const sibs = parent.children.filter((c) => c.side === first.side);
    const idx = nodes.map((n) => sibs.indexOf(n!));
    const covers = sibs.slice(Math.min(...idx), Math.max(...idx) + 1).map((c) => c.id);
    if (parent.summaries.some((s) => s.covers.some((c) => covers.includes(c)))) {
      new Notice("Some of these topics already have a summary.");
      return null;
    }
    const top = map.nodes.get(covers[0])!;
    const id = createNode(tx, ea, {
      depth: top.depth,
      branch: branchOf(top),
      style: summaryStyle(),
      text: SUMMARY_TEXT,
      data: { root: map.root.id, parent: parent.id, order: 0, summary: covers, ...(top.depth === 1 ? { side: top.side as Side } : {}) },
      at: { x: top.el.x + top.el.width + 40, y: top.el.y },
      fontFamily: top.text?.fontFamily ?? tx.api.getAppState().currentItemFontFamily,
      roughness: top.el.roughness,
    });
    layoutMap(tx, ea, map.root.id);
    return id;
  });
  if (id) await focusNode(view, id, true);
}

/** Puts a boundary around the given sibling topics and everything between them, like XMind's Boundary. */
export async function addBoundary(view: ExcalidrawView, nodeIds: string[]) {
  const title = run(view, (tx, ea) => {
    const found = nodeIds.length ? mapOf(tx, nodeIds[0]) : null;
    if (!found) return null;
    const { map, node: first } = found;
    const parent = first.parent;
    const nodes = nodeIds.map((id) => map.nodes.get(id));
    if (!parent || nodes.some((n) => !n || n.parent !== parent || n.covers || n.side !== first.side)) {
      new Notice("Select one or more sibling topics to put a boundary around.");
      return null;
    }
    const sibs = parent.children.filter((c) => c.side === first.side);
    const idx = nodes.map((n) => sibs.indexOf(n!));
    const covered = sibs.slice(Math.min(...idx), Math.max(...idx) + 1);
    const ids = covered.map((c) => c.id);
    for (const b of parent.boundaries) {
      const inside = b.covers.every((id) => ids.includes(id));
      const around = ids.every((id) => b.covers.includes(id));
      if (inside && around) return void new Notice("These topics already have a boundary.");
      if (!inside && !around && b.covers.some((id) => ids.includes(id)))
        return void new Notice("A boundary can't partly overlap another one.");
    }

    // Behind the map, but in front of the boundaries around this one and behind those inside it.
    const enclosed = new Set(covered.flatMap((c) => subtree(c).map((n) => n.id)));
    const below = [
      ...[...map.nodes.values()].flatMap((n) => [n.el, n.text]),
      ...map.edges.values(),
      ...map.braces.values(),
      ...[...map.boundaries.values()].filter((b) => b.covers.every((id) => enclosed.has(id))).flatMap((b) => [b.el, b.title]),
    ];
    const indexes = below.map((el) => (el ? tx.indexOf(el.id) : -1)).filter((i) => i >= 0);
    const els = createBoundary(ea, map.root.id, parent, covered);
    if (indexes.length) tx.insert(els, Math.min(...indexes));
    else els.forEach((el) => tx.add(el));
    layoutMap(tx, ea, map.root.id);
    return els[1].id;
  });
  if (title) await focusNode(view, title, true);
}

/** Deletes a boundary with its title; the topics it enclosed stay. */
export async function deleteBoundary(view: ExcalidrawView, boundaryId: string) {
  const next = run(view, (tx, ea) => {
    const root = rootIdOf(tx.get(boundaryId));
    const b = root ? buildMap(tx.live(), root)?.boundaries.get(boundaryId) : undefined;
    if (!root || !b) return null;
    deleteBoundaryEls(tx, b);
    layoutMap(tx, ea, root);
    return b.covers[0];
  });
  if (next) await focusNode(view, next, false);
}

export async function editBoundaryTitle(view: ExcalidrawView, boundaryId: string) {
  const title = view.excalidrawAPI?.getSceneElements().find((e) => titleData(e)?.boundary === boundaryId);
  if (!title) return;
  select(view, title.id);
  await nextFrame();
  await startEditing(view, true);
}

export async function editNode(view: ExcalidrawView, nodeId: string) {
  select(view, nodeId);
  await nextFrame();
  await startEditing(view, true);
}

export function navigate(view: ExcalidrawView, nodeId: string, dir: Direction) {
  const api = view.excalidrawAPI;
  if (!api) return;
  const els = api.getSceneElements();
  const d = nodeData(els.find((e) => e.id === nodeId));
  const map = d ? buildMap(els, d.root) : null;
  const n = map?.nodes.get(nodeId);
  if (!map || !n) return;

  const cy = (m: MMNode) => m.el.y + m.el.height / 2;
  const closest = (cands: MMNode[]) =>
    cands.reduce<MMNode | undefined>((best, c) => (!best || Math.abs(cy(c) - cy(n)) < Math.abs(cy(best) - cy(n)) ? c : best), undefined);

  let target: MMNode | undefined | null;
  if (dir === "left" || dir === "right") {
    const side: Side = dir === "right" ? "R" : "L";
    if (n.depth === 0 || n.side === side) {
      // Outward: the children, or for a leaf the summary spanning it.
      const summaries = n.parent?.summaries.filter((s) => s.covers.includes(n.id)).map((s) => s.node) ?? [];
      target = closest((n.folded ? [] : n.children).filter((c) => c.side === side)) ?? closest(summaries);
    } else {
      // Inward: a summary goes back to the topics it spans.
      target = n.covers ? closest(n.covers.map((id) => map.nodes.get(id)!)) : n.parent;
    }
  } else if (n.depth > 0) {
    const up = dir === "up";
    const peers = [...map.nodes.values()].filter(
      (m) => m !== n && m.depth === n.depth && m.side === n.side && !m.covers === !n.covers && !isHidden(m),
    );
    target = closest(peers.filter((m) => (up ? cy(m) < cy(n) - 1 : cy(m) > cy(n) + 1)));
  }
  if (target) select(view, target.id);
}

function setFolded(tx: SceneTx, n: MMNode, folded: boolean) {
  if (!!n.data.folded === folded) return;
  const { folded: _, ...rest } = n.data;
  tx.patch(n.id, { customData: { ...n.el.customData, [KEY]: folded ? { ...rest, folded } : rest } });
}

const canFold = (n: MMNode) => !!n.parent && (n.children.length > 0 || n.summaries.length > 0);
const topics = (n: MMNode) => [...n.children, ...n.summaries.map((s) => s.node)];

/** Whether collapse and expand apply to the node: a topic with subtopics, or a central topic with main topics that have some. */
const foldable = (n: MMNode) => (n.parent ? canFold(n) : topics(n).some(canFold));

/** A topic is collapsed when folded; the central topic, which never folds, when all its main topics with subtopics are. */
const collapsed = (n: MMNode) => (n.parent ? !!n.folded : topics(n).filter(canFold).every((c) => c.folded));

/** Whether the node can be collapsed or expanded, and whether it is collapsed now. */
export function foldState(view: ExcalidrawView, nodeId: string): { foldable: boolean; collapsed: boolean } {
  const els = view.excalidrawAPI?.getSceneElements() ?? [];
  const d = nodeData(els.find((e) => e.id === nodeId));
  const n = d ? buildMap(els, d.root)?.nodes.get(nodeId) : undefined;
  return n && foldable(n) ? { foldable: true, collapsed: collapsed(n) } : { foldable: false, collapsed: false };
}

/** Folds or unfolds every topic with subtopics in the node's subtree, the node included. */
function foldSubtree(tx: SceneTx, ea: any, map: MindMap, node: MMNode, folded: boolean) {
  for (const n of subtree(node)) setFolded(tx, n, folded && canFold(n));
  layoutMap(tx, ea, map.root.id);
}

/**
 * Collapses the topic with everything below it, or expands it all again, like XMind's Collapse/Expand.
 * On the central topic, it collapses or expands all main topics.
 */
export async function toggleFold(view: ExcalidrawView, nodeId: string) {
  const done = run(view, (tx, ea) => {
    const found = mapOf(tx, nodeId);
    if (!found || !foldable(found.node)) return false;
    foldSubtree(tx, ea, found.map, found.node, !collapsed(found.node));
    return true;
  });
  if (done) await focusNode(view, nodeId, false);
}

/** Expands the topic with everything below it and selects it. */
export async function unfold(view: ExcalidrawView, nodeId: string) {
  run(view, (tx, ea) => {
    const found = mapOf(tx, nodeId);
    if (found) foldSubtree(tx, ea, found.map, found.node, false);
  });
  await focusNode(view, nodeId, false);
}

function rootsIn(els: readonly El[]): string[] {
  return els.filter((e) => !e.isDeleted && nodeData(e)?.parent === null).map((e) => e.id);
}

/** Re-layouts the map of the given node, or every map in the drawing. */
export function relayout(view: ExcalidrawView, nodeId?: string) {
  run(view, (tx, ea) => {
    const r = nodeId ? rootIdOf(tx.get(nodeId)) : null;
    for (const root of r ? [r] : rootsIn(tx.live())) layoutMap(tx, ea, root);
  });
}

/** Drops manual adjustments for the node's subtree, or for every map in the drawing. */
export function resetLayout(view: ExcalidrawView, nodeId?: string) {
  run(view, (tx, ea) => {
    const roots: string[] = [];
    const targets: MMNode[] = [];
    if (nodeId) {
      const found = mapOf(tx, nodeId);
      if (!found) return;
      roots.push(found.map.root.id);
      targets.push(...subtree(found.node));
    } else {
      for (const r of rootsIn(tx.live())) {
        const map = buildMap(tx.live(), r);
        if (!map) continue;
        roots.push(r);
        targets.push(...map.nodes.values());
      }
    }
    for (const n of targets) {
      const { ox, oy, lx, ly, ...rest } = n.data;
      tx.patch(n.id, { customData: { ...n.el.customData, [KEY]: rest } });
    }
    for (const r of roots) layoutMap(tx, ea, r);
  });
}
