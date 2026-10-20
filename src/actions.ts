import { Notice } from "obsidian";
import { Binding, El, ExcalidrawAutomate, ExcalidrawView, SceneTx, getEA } from "./excalidraw";
import {
  Box, Brace, MOVE_EPSILON, RELATION_BEND, Side, Vec, bracePoints, computeLayout, dropsOnto, edgePoints, findFreeSpot, relationBend, relationPoints, updateOffsets,
} from "./layout";
import {
  HIDDEN_KEY, HiddenState, KEY, autoAligned, MMBadge, MMBoundary, MMNode, MMSummary, MindMap, NodeData, RelationData, Structure, badgeData, balancedSplit, byOrder, boundTextId, boundaryData, braceData,
  buildMap, edgeData, hiddenState, isHidden, isRelationLabel, nodeData, orderLine, rangesIn, relationData, resolveNodeElement, rootIdOf, structureIn,
  structureOf, subtree, titleData, twoSided,
} from "./model";
import { OutlineItem, parseOutline, toMarkdown } from "./outline";
import {
  BADGE_FONT_SIZE, BADGE_GAP, BADGE_PADDING, BOUNDARY_TEXT, Branch, DEFAULT_TEXT, MIN_TEXT_WIDTH, NodeStyle, SUMMARY_PADDING,
  SUMMARY_TEXT, TITLE_FONT_SIZE, TITLE_PADDING, boundaryColors, branchColor, connectorArrowhead, paddingFor, relationshipColors,
  newMapDefaults, styleFor, summaryStyle,
} from "./styles";

export type Direction = "up" | "down" | "left" | "right";

const nextFrame = () => new Promise<void>((r) => window.requestAnimationFrame(() => r()));
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

/**
 * The mind map topics selected in the view, ignoring the connectors, braces, badges and boundaries
 * selected along with them (as a selection box does); empty when anything else is selected.
 */
export function selectedTopics(view: ExcalidrawView): El[] {
  const api = view.excalidrawAPI;
  if (!api) return [];
  const sel = api.getAppState().selectedElementIds ?? {};
  const byId = new Map(api.getSceneElements().map((e) => [e.id, e]));
  const nodes = new Map<string, El>();
  for (const id of Object.keys(sel).filter((k) => sel[k])) {
    let el = byId.get(id);
    if (el?.type === "text" && el.containerId) el = byId.get(el.containerId);
    if (nodeData(el)) nodes.set(el!.id, el!);
    else if (!edgeData(el) && !braceData(el) && !badgeData(el) && !boundaryData(el) && !titleData(el) && !relationData(el)) return [];
  }
  return [...nodes.values()];
}

/** What an element stands for as an end of a relationship: its topic, or its boundary's frame for a frame or title. */
function relationEnd(el: El | undefined, get: (id: string) => El | undefined): El | null {
  if (el?.type === "text" && el.containerId) el = get(el.containerId);
  const title = titleData(el);
  if (title) el = get(title.boundary);
  return el && !el.isDeleted && (nodeData(el) || boundaryData(el)) ? el : null;
}

/**
 * The topics and boundaries selected, a boundary by its frame or title, in the order they were selected;
 * empty when anything else is selected too.
 */
export function selectedEnds(view: ExcalidrawView): string[] {
  const api = view.excalidrawAPI;
  if (!api) return [];
  const sel = api.getAppState().selectedElementIds ?? {};
  const byId = new Map(api.getSceneElements().map((e) => [e.id, e]));
  const ends: string[] = [];
  for (const id of Object.keys(sel).filter((k) => sel[k])) {
    const end = relationEnd(byId.get(id), (i) => byId.get(i));
    if (!end) return [];
    if (!ends.includes(end.id)) ends.push(end.id);
  }
  return ends;
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
  return !!cid && !!titleData(api.getSceneElements().find((e) => e.id === cid));
}

/** The mind map node whose text is being edited, if any. */
export function editingNode(view: ExcalidrawView): El | null {
  const api = view.excalidrawAPI;
  const cid = api?.getAppState().editingTextElement?.containerId;
  if (!cid) return null;
  const el = api.getSceneElements().find((e) => e.id === cid);
  return el && nodeData(el) ? el : null;
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

function createNode(tx: SceneTx, ea: ExcalidrawAutomate, n: NewNode): string {
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
  const id = ea.addText(n.at.x, n.at.y, n.text ?? DEFAULT_TEXT[Math.min(n.depth, 2)], {
    box: true,
    boxPadding: st.padX,
    boxStrokeColor: st.borderColor,
    textAlign: "center",
    textVerticalAlign: "middle",
  });
  for (const el of ea.getElements()) {
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

/** Where a connector is glued to the parent and to the child: the facing middles of their sides. */
const gluePoints = (side: Side): { start: [number, number]; end: [number, number] } =>
  side === "R" ? { start: [1, 0.5], end: [0, 0.5] } : { start: [0, 0.5], end: [1, 0.5] };

function createEdge(tx: SceneTx, ea: ExcalidrawAutomate, rootId: string, n: MMNode, start: Vec, end: Vec) {
  const parent = n.parent!;
  const glue = gluePoints(n.side as Side);
  ea.clear();
  Object.assign(ea.style, {
    strokeColor: n.el.strokeColor,
    strokeWidth: n.depth === 1 ? 2 : 1.5,
    strokeStyle: "solid",
    roughness: n.el.roughness,
    roundness: null,
    opacity: 100,
  });
  const id = ea.addArrow(
    [[start.x, start.y], [end.x, end.y]],
    {
      startArrowHead: null,
      endArrowHead: connectorArrowhead(),
      startObjectId: parent.id,
      endObjectId: n.id,
      startFixedPoint: glue.start,
      endFixedPoint: glue.end,
    },
  );
  const el = ea.getElement(id);
  el.customData = { [KEY]: { edge: true, root: rootId, parent: parent.id, child: n.id } };
  tx.add(el);
  addBound(tx, parent.id, id);
  addBound(tx, n.id, id);
  ea.clear();
}

function createBrace(tx: SceneTx, ea: ExcalidrawAutomate, rootId: string, summary: MMNode, b: Brace) {
  ea.clear();
  Object.assign(ea.style, {
    strokeColor: summary.el.strokeColor,
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: summary.el.roughness,
    roundness: { type: 2 }, // smooth curve through the points
    opacity: 100,
  });
  const id = ea.addLine(bracePoints(b).map(([x, y]) => [b.x + x, b.y + y]));
  const el = ea.getElement(id);
  el.customData = { [KEY]: { brace: true, root: rootId, summary: summary.id } };
  tx.add(el);
  ea.clear();
}

/** Title tab of a boundary: a container with bound text, not yet added to the scene. */
function createTitle(ea: ExcalidrawAutomate, rootId: string, boundaryId: string, at: Vec, roughness: number, fontFamily: number): El[] {
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
  const id = ea.addText(at.x, at.y, BOUNDARY_TEXT, {
    box: true,
    boxPadding: TITLE_PADDING.padX,
    boxStrokeColor: c.titleFill,
    textAlign: "center",
    textVerticalAlign: "middle",
  });
  const els = ea.getElements();
  for (const el of els) if (el.id === id) el.customData = { [KEY]: { boundaryTitle: true, self: id, root: rootId, boundary: boundaryId } };
  // Container before its text.
  els.sort((a, b) => (a.type === "text" ? 1 : 0) - (b.type === "text" ? 1 : 0));
  ea.clear();
  return els;
}

/** Boundary frame with its title around the topics, from the first one, not yet added to the scene. */
function createBoundary(ea: ExcalidrawAutomate, rootId: string, parentId: string, topics: string[], first: MMNode): El[] {
  const c = boundaryColors();
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
  const id = ea.addRect(first.el.x, first.el.y, first.el.width, first.el.height);
  const frame = ea.getElement(id);
  frame.customData = { [KEY]: { boundary: true, self: id, root: rootId, parent: parentId, topics } };
  ea.clear();
  const font = first.text?.fontFamily ?? 1;
  return [frame, ...createTitle(ea, rootId, id, { x: first.el.x, y: first.el.y - 30 }, first.el.roughness, font)];
}

/** Fold badge of a topic: a circle with the count of hidden topics, added to the scene. */
function createBadge(tx: SceneTx, ea: ExcalidrawAutomate, rootId: string, n: MMNode, count: string): [El, El] {
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
  const id = ea.addText(n.el.x + n.el.width, n.el.y, count, {
    box: "ellipse",
    boxPadding: BADGE_PADDING.padX,
    boxStrokeColor: n.el.strokeColor,
    textAlign: "center",
    textVerticalAlign: "middle",
  });
  const els = ea.getElements();
  for (const el of els) if (el.id === id) el.customData = { [KEY]: { badge: true, self: id, root: rootId, node: n.id } };
  els.sort((a, b) => (a.type === "text" ? 1 : 0) - (b.type === "text" ? 1 : 0));
  els.forEach((el) => tx.add(el));
  ea.clear();
  return [els[0], els[1]];
}

/**
 * Hides an element: invisible, locked and without its link icon, keeping its own opacity, lock and link
 * to restore when shown again.
 */
function setHidden(tx: SceneTx, id: string, hidden: boolean) {
  const el = tx.get(id);
  if (!el) return;
  const saved = hiddenState(el);
  if (hidden) {
    if (saved && el.opacity === 0 && el.locked && !el.link && !el.hasTextLink) return;
    const keep: HiddenState = saved ?? { opacity: el.opacity ?? 100, locked: !!el.locked, link: el.link ?? null, hasTextLink: !!el.hasTextLink };
    tx.patch(id, { opacity: 0, locked: true, link: null, hasTextLink: false, customData: { ...el.customData, [HIDDEN_KEY]: keep } });
  } else if (saved) {
    const { [HIDDEN_KEY]: _, ...rest } = el.customData ?? {};
    const link = saved.link === undefined ? {} : { link: saved.link, hasTextLink: !!saved.hasTextLink };
    tx.patch(id, { opacity: saved.opacity, locked: saved.locked, ...link, customData: rest });
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

function measureBox(ea: ExcalidrawAutomate, text: El | null, pad: { padX: number; padY: number }): NodeSize {
  let tw = MIN_TEXT_WIDTH;
  let th = 20;
  if (text) {
    ea.style.fontFamily = text.fontFamily;
    ea.style.fontSize = text.fontSize;
    const raw = text.originalText ?? text.text ?? "";
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
function layoutMap(tx: SceneTx, ea: ExcalidrawAutomate, rootId: string): MindMap | null {
  let m = buildMap(tx.live(), rootId);
  if (!m) return null;
  // What the user did by dragging since the last layout, a step at a time on the map as the step before left it.
  // Topics that left or joined a boundary or summary, or changed sides, are kept where they were dropped.
  const dropped = new Set<string>();
  const reparent = (t: SceneTx, mm: MindMap) => reparentDropped(t, ea, mm);
  for (const step of [reparent, moveBoundaries, fitBoundaries, leaveBoundaries, leaveSummaries, crossSides, joinBoundaries, joinSummaries, reorderDropped]) {
    const rev = tx.revision;
    for (const id of step(tx, m) ?? []) dropped.add(id);
    if (tx.revision === rev) continue;
    const next = buildMap(tx.live(), rootId);
    if (!next) return null; // its central topic was dropped into another map
    m = next;
  }
  const map = m;
  const aligned = autoAligned(map.root.data);

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

  // Auto-aligned, no topic keeps a manual move.
  const offsets = aligned ? new Map<string, Vec>() : updateOffsets(map.root, (id) => {
    const n = map.nodes.get(id)!;
    return { x: n.el.x, y: n.el.y, lx: n.data.lx, ly: n.data.ly, ox: n.data.ox ?? 0, oy: n.data.oy ?? 0 };
  });
  const r = map.root.el;
  const place = () => computeLayout(
    map.root,
    (id) => sizes.get(id)!,
    (id) => offsets.get(id) ?? { x: 0, y: 0 },
    { x: r.x + r.width / 2, y: r.y + r.height / 2 },
  );
  // Otherwise a dropped topic stays where it is: its offset is taken from its new place.
  if (dropped.size && !aligned) {
    for (const id of dropped) offsets.set(id, { x: 0, y: 0 });
    const auto = place().boxes;
    for (const id of dropped) {
      const el = map.nodes.get(id)!.el;
      offsets.set(id, { x: el.x - auto.get(id)!.x, y: el.y - auto.get(id)!.y });
    }
  }
  const { boxes, braces, boundaries } = place();
  const sided = twoSided(structureOf(map.root));

  for (const n of map.nodes.values()) {
    const b = boxes.get(n.id);
    if (!b) continue; // hidden by a folded topic, stays where it was
    const s = sizes.get(n.id)!;
    const o = offsets.get(n.id) ?? { x: 0, y: 0 };
    const data: NodeData = { ...n.data, parent: n.parent?.id ?? null, lx: b.x, ly: b.y, ox: o.x, oy: o.y };
    if (n.depth === 1 && sided) data.side = n.side!; // a one-sided map keeps the sides for when it is two-sided again
    placeBox(tx, n.el, n.text, b, s, padOf(n), sameData(n.data, data) ? {} : { customData: { ...n.el.customData, [KEY]: data } });
  }

  for (const [id, { frame, title }] of boundaries) {
    const b = map.boundaries.get(id)!;
    const d = boundaryData(b.el)!;
    const placed = near(d.lx, frame.x) && near(d.ly, frame.y) && near(d.lw, frame.w) && near(d.lh, frame.h);
    const data = { ...d, lx: frame.x, ly: frame.y, lw: frame.w, lh: frame.h };
    placeBox(tx, b.el, null, frame, sizes.get(id)!, TITLE_PADDING, placed ? {} : { customData: { ...b.el.customData, [KEY]: data } });
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
    const pts = edge.points;
    const same = near(edge.x, start.x) && near(edge.y, start.y) && pts?.length === 2 && near(pts[1][0], dx) && near(pts[1][1], dy);
    if (!same)
      tx.patch(edge.id, { x: start.x, y: start.y, points: [[0, 0], [dx, dy]], width: Math.abs(dx), height: Math.abs(dy) });
    // A branch that changed sides gets glued to the other sides, or Excalidraw would route it back when a topic is dragged.
    const glue = gluePoints(n.side as Side);
    const reglue = (b: Binding | null | undefined, p: [number, number]) =>
      b?.fixedPoint && !(near(b.fixedPoint[0], p[0]) && near(b.fixedPoint[1], p[1])) ? { ...b, fixedPoint: p } : null;
    const sb = reglue(edge.startBinding, glue.start);
    const eb = reglue(edge.endBinding, glue.end);
    if (sb || eb) tx.patch(edge.id, { ...(sb ? { startBinding: sb } : {}), ...(eb ? { endBinding: eb } : {}) });
  }
  for (const e of map.strayEdges) removeEdge(tx, e);

  for (const [id, b] of braces) {
    const brace = map.braces.get(id);
    if (!brace) {
      createBrace(tx, ea, rootId, map.nodes.get(id)!, b);
      continue;
    }
    const pts = bracePoints(b);
    const cur = brace.points;
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
  layoutRelations(tx, map);
  return map;
}

/** Gives the topics the orders 0, 1, 2... in the sequence given, with any more data for each. */
function renumber(tx: SceneTx, line: MMNode[], more: (n: MMNode) => Partial<NodeData> = () => ({})) {
  line.forEach((n, i) => {
    const m = more(n);
    if (n.data.order !== i || Object.keys(m).length)
      tx.patch(n.id, { customData: { ...n.el.customData, [KEY]: { ...n.data, order: i, ...m } } });
  });
}

/** A boundary or a summary: either spans a run of siblings, from the first topic it lists to the last. */
type Range = MMBoundary | MMSummary;

const rangesOf = (p: MMNode): Range[] => [...p.boundaries, ...p.summaries];

/** Makes the boundary or summary list exactly these topics. */
function relist(tx: SceneTx, r: Range, ids: string[]) {
  const id = "node" in r ? r.node.id : r.id;
  const el = tx.get(id)!;
  const d = el.customData![KEY] as object;
  tx.patch(id, { customData: { ...el.customData, [KEY]: { ...d, ["node" in r ? "summary" : "topics"]: ids } } });
}

/**
 * A place among the siblings (top to bottom) moved out of the ranges of topics given, so a topic put there
 * doesn't join them: to just before or after the range, whichever side of its middle y is on.
 */
function clearOfRanges(at: number, sibs: MMNode[], ranges: string[][], y: number): number {
  for (const covers of ranges) {
    const from = sibs.findIndex((c) => c.id === covers[0]);
    const to = sibs.findIndex((c) => c.id === covers[covers.length - 1]);
    if (from < 0 || to < 0 || at <= from || at > to) continue;
    at = y > (middle(sibs[from].el).y + middle(sibs[to].el).y) / 2 ? to + 1 : from;
  }
  return at;
}

// ---------- what the user dragged since the last layout ----------

const middle = (el: El): Vec => ({ x: el.x + el.width / 2, y: el.y + el.height / 2 });

const middleIn = (el: El, area: El | Box) => {
  const c = middle(el);
  const [w, h] = "w" in area ? [area.w, area.h] : [area.width, area.height];
  return c.x >= area.x && c.x <= area.x + w && c.y >= area.y && c.y <= area.y + h;
};

/** How far the element is from where the layout last put it; null before its first layout. */
const shiftOf = (el: El, at: { lx?: number; ly?: number }): Vec | null =>
  at.lx === undefined || at.ly === undefined ? null : { x: el.x - at.lx, y: el.y - at.ly };

const isMove = (v: Vec) => Math.max(Math.abs(v.x), Math.abs(v.y)) >= MOVE_EPSILON;

/** Main topics of a two-sided map dragged since the last layout to the other side of the central topic. */
function crossedTopics(map: MindMap): MMNode[] {
  if (!twoSided(structureOf(map.root))) return [];
  const cx = middle(map.root.el).x;
  return map.root.children.filter((n) => {
    const shift = shiftOf(n.el, n.data);
    return !!shift && isMove(shift) && middle(n.el).x < cx !== (n.side === "L");
  });
}

/** Whether the user moved a topic or a boundary's frame since the map's last layout. */
const moved = (map: MindMap) =>
  [...map.nodes.values()].some((n) => { const s = shiftOf(n.el, n.data); return !!s && isMove(s); }) ||
  [...map.boundaries.values()].some(reshaped);

/**
 * Once something is dropped, the maps of the selection are laid out when anything in them moved, so subtopics
 * follow their topic and what the drop means (side, boundary, summary, place among siblings) shows right away.
 */
export function afterDrag(view: ExcalidrawView) {
  const api = view.excalidrawAPI;
  if (!api) return;
  const els = api.getSceneElements();
  const byId = new Map(els.map((e) => [e.id, e]));
  const sel = api.getAppState().selectedElementIds ?? {};
  const roots = new Set<string>();
  for (const id of Object.keys(sel).filter((k) => sel[k])) {
    const el = byId.get(id);
    const r = rootIdOf(el?.type === "text" && el.containerId ? byId.get(el.containerId) : el);
    if (r) roots.add(r);
  }
  for (const r of roots) {
    const map = buildMap(els, r);
    if (map && moved(map)) relayout(view, r);
  }
}

/** While topics are dragged, the box of the topic they become subtopics of if dropped now; null when none. */
export function dropTargetBox(view: ExcalidrawView): Box | null {
  const api = view.excalidrawAPI;
  if (!api) return null;
  const els = api.getSceneElements();
  const byId = new Map(els.map((e) => [e.id, e]));
  const sel = api.getAppState().selectedElementIds ?? {};
  const roots = new Set<string>();
  for (const id of Object.keys(sel).filter((k) => sel[k])) {
    const r = rootIdOf(resolveNodeElement(byId.get(id), byId));
    if (r) roots.add(r);
  }
  for (const r of roots) {
    const map = buildMap(els, r);
    const found = map && dropTarget(els, map);
    if (found) return boxOf(found.target.el);
  }
  return null;
}

/** How far the user moved the boundary's frame since the last layout, without resizing it; null when not. */
function shifted(b: MMBoundary): Vec | null {
  const d = boundaryData(b.el)!;
  const shift = shiftOf(b.el, d);
  if (!shift || !isMove(shift) || d.lw === undefined || d.lh === undefined || b.el.customData?.[HIDDEN_KEY]) return null;
  return isMove({ x: b.el.width - d.lw, y: b.el.height - d.lh }) ? null : shift;
}

/**
 * A boundary whose frame the user moved takes along its topics, with the boundaries and summary braces among them,
 * as if they had been dragged with it: across to the other side, and in an auto-aligned map among their siblings
 * by height, as a whole. Topics moved along with the frame already stay where they are.
 */
function moveBoundaries(tx: SceneTx, map: MindMap) {
  for (const b of map.boundaries.values()) {
    const shift = shifted(b);
    if (!shift) continue;
    const ids = new Set(b.covers);
    const by = (el: El | null | undefined) => el && tx.patch(el.id, { x: el.x + shift.x, y: el.y + shift.y });
    for (const id of ids) {
      const n = map.nodes.get(id)!;
      const own = shiftOf(n.el, n.data);
      if (own && isMove(own)) continue;
      by(n.el);
      by(n.text);
    }
    // Inner frames and braces go along, so their topics stay inside; this frame now counts as placed where it is.
    for (const o of b.parent.boundaries) {
      if (o === b || !o.covers.every((id) => ids.has(id))) continue;
      by(o.el);
      by(o.title);
      by(o.titleText);
      const d = boundaryData(o.el)!;
      tx.patch(o.id, { customData: { ...tx.get(o.id)!.customData, [KEY]: { ...d, lx: (d.lx ?? 0) + shift.x, ly: (d.ly ?? 0) + shift.y } } });
    }
    for (const sm of b.parent.summaries) if (sm.covers.every((id) => ids.has(id))) by(map.braces.get(sm.node.id));
    tx.patch(b.id, { customData: { ...b.el.customData, [KEY]: { ...boundaryData(b.el)!, lx: b.el.x, ly: b.el.y } } });

    // Across the central topic, crossing sides takes it from here; otherwise an auto-aligned map moves it among its siblings.
    const p = b.parent;
    const members = b.covers.map((id) => map.nodes.get(id)!);
    const side = members[0].side;
    const crosses = !p.parent && twoSided(structureOf(p)) && middle(b.el).x < middle(p.el).x !== (side === "L");
    if (crosses || !autoAligned(map.root.data)) continue;
    const y = middle(b.el).y;
    const sibs = p.children.filter((c) => c.side === side && !ids.has(c.id)); // top to bottom
    const index = (cid: string) => sibs.findIndex((c) => c.id === cid);
    let at = sibs.findIndex((c) => middle(c.el).y > y);
    if (at < 0) at = sibs.length;
    // Within the narrowest range around it, listed so its end keeps it in; out of the others.
    const around = rangesOf(p).filter((r) => r !== b && r.covers.length > ids.size && b.covers.every((id) => r.covers.includes(id)));
    for (const r of around) if (!b.covers.every((id) => lists(r, id))) relist(tx, r, r.covers);
    if (around.length) {
      const inner = around.reduce((a, c) => (c.covers.length < a.covers.length ? c : a)).covers.filter((id) => !ids.has(id));
      at = Math.min(Math.max(at, index(inner[0])), index(inner[inner.length - 1]) + 1);
    }
    at = clearOfRanges(at, sibs, rangesOf(p).filter((r) => !r.covers.some((id) => ids.has(id))).map((r) => r.covers), y);
    sibs.splice(at, 0, ...members);
    place(tx, members, sibs);
  }
}

/** Whether the user resized or moved the boundary's frame since the last layout. */
function reshaped(b: MMBoundary): boolean {
  const d = boundaryData(b.el)!;
  const shift = shiftOf(b.el, d);
  if (!shift || d.lw === undefined || d.lh === undefined || b.el.customData?.[HIDDEN_KEY]) return false;
  return isMove(shift) || isMove({ x: b.el.width - d.lw, y: b.el.height - d.lh });
}

/**
 * A boundary whose frame the user resized takes in the sibling topics whose middle is now inside it,
 * from the first to the last of them, and whole any boundary that range would partly overlap. With none inside,
 * it keeps its topics.
 */
function fitBoundaries(tx: SceneTx, map: MindMap) {
  for (const b of map.boundaries.values()) {
    if (!reshaped(b)) continue;
    const side = map.nodes.get(b.covers[0])?.side;
    const sibs = b.parent.children.filter((c) => c.side === side); // top to bottom
    const inside = sibs.flatMap((c, i) => (middleIn(c.el, b.el) ? [i] : []));
    if (!inside.length) continue;
    let from = Math.min(...inside);
    let to = Math.max(...inside);
    // Boundaries and summaries nest, so one the range would cut through is taken in whole.
    const others = [...b.parent.boundaries.filter((o) => o !== b), ...b.parent.summaries].map((o) => o.covers);
    for (let grown = true; grown; ) {
      grown = false;
      for (const covers of others) {
        const idx = covers.map((id) => sibs.findIndex((c) => c.id === id));
        if (idx.some((i) => i < 0)) continue;
        const [lo, hi] = [Math.min(...idx), Math.max(...idx)];
        const partly = lo <= to && hi >= from && !(lo >= from && hi <= to) && !(lo <= from && hi >= to);
        if (!partly) continue;
        [from, to] = [Math.min(from, lo), Math.max(to, hi)];
        grown = true;
      }
    }
    const covers = sibs.slice(from, to + 1).map((c) => c.id);
    if (covers.length === b.covers.length && covers.every((id, i) => id === b.covers[i])) continue;
    relist(tx, b, covers);
  }
}

/** Whether the topic was dragged since the last layout, other than along with its parent. */
function dragged(n: MMNode): boolean {
  const own = shiftOf(n.el, n.data);
  const base = (n.parent && shiftOf(n.parent.el, n.parent.data)) ?? { x: 0, y: 0 };
  return !!own && isMove({ x: own.x - base.x, y: own.y - base.y });
}

interface Drop {
  nodes: MMNode[]; // dropped, with their subtopics, top-level ones only
  target: MMNode;
  into: MindMap; // the target's map
  at: Vec; // middle of the topic that landed on the target
}

/**
 * A topic dragged onto a topic of any map in the drawing, not its parent or one under it: the topic under its
 * middle, the nearest of them. A central topic dragged onto another map's topic brings its whole map. The topics
 * dragged along with it go too, except those already under that topic or above it, and those under another one going.
 */
function dropTarget(els: readonly El[], map: MindMap): Drop | null {
  const drag = [...map.nodes.values()].filter((n) => !n.covers && !isHidden(n) && dragged(n));
  if (!drag.length) return null;
  const maps = [map, ...rootsIn(els).filter((r) => r !== map.root.id).map((r) => buildMap(els, r)).filter((m): m is MindMap => !!m)];
  const targets = maps.flatMap((m) => [...m.nodes.values()].filter((t) => !isHidden(t) && !drag.includes(t)).map((t) => ({ t, m })));
  const dist = (t: MMNode, at: Vec) => { const c = middle(t.el); return Math.hypot(c.x - at.x, c.y - at.y); };
  for (const n of drag) {
    const at = middle(n.el);
    const below = subtree(n);
    const hits = targets.filter(({ t }) => t !== n.parent && !below.includes(t) && dropsOnto(at, boxOf(t.el)));
    if (!hits.length) continue;
    const { t: target, m: into } = hits.reduce((a, b) => (dist(b.t, at) < dist(a.t, at) ? b : a));
    const going = drag.filter((d) => d.parent !== target && !subtree(d).includes(target));
    const nodes = going.filter((d) => !going.some((o) => o !== d && subtree(o).includes(d)));
    return { nodes, target, into, at };
  }
  return null;
}

/** The main topic of the node's branch; for a summary of main topics, the first topic it spans. */
function mainOf(map: MindMap, n: MMNode): MMNode {
  while (n.depth > 1) n = n.parent!;
  return n.covers ? map.nodes.get(n.covers[0])! : n;
}

/**
 * Topics dragged onto another topic become its subtopics, going among the ones it has by height, clear of its
 * boundaries and summaries; onto the central topic, on the side they are dropped on. They leave the boundaries and
 * summaries they were in, and those left with nothing go. A topic that becomes a main topic takes the next branch
 * color, one that moves to another branch takes that branch's color. They go to their automatic place there.
 * Onto a topic of another map, they move into that map, which is laid out too; a central topic brings its whole map.
 */
function reparentDropped(tx: SceneTx, ea: ExcalidrawAutomate, map: MindMap) {
  const found = dropTarget(tx.live(), map);
  if (!found) return;
  const { target, into, nodes, at } = found;
  const across = into !== map;
  const moving = new Set(nodes.map((n) => n.id));

  for (const p of new Set(nodes.flatMap((n) => (n.parent ? [n.parent] : [])))) {
    for (const r of rangesOf(p)) {
      const rest = r.covers.filter((id) => !moving.has(id));
      if (rest.length === r.covers.length) continue;
      if (rest.length) relist(tx, r, rest);
      else if (!("node" in r)) deleteBoundaryEls(tx, r);
      else if (!subtree(r.node).includes(target)) deleteSubtree(tx, map, r.node);
    }
  }
  const t = nodeData(tx.get(target.id))!; // relisted when it is a summary they left
  if (t.folded) {
    const { folded: _, ...rest } = t;
    tx.patch(target.id, { customData: { ...tx.get(target.id)!.customData, [KEY]: rest } });
  }

  const central = !target.parent;
  const structure = structureOf(into.root);
  const side: Side = !central ? (target.side as Side)
    : structure === "right" ? "R" : structure === "left" ? "L"
    : at.x < middle(target.el).x ? "L" : "R";
  const cy = (n: MMNode) => middle(n.el).y;
  const run = [...nodes].sort((a, b) => cy(a) - cy(b));
  const sibs = target.children.filter((c) => c.side === side); // top to bottom
  let i = sibs.findIndex((c) => cy(c) > at.y);
  if (i < 0) i = sibs.length;
  const ranges = rangesOf(target).map((r) => r.covers);
  let line = sibs;
  if (central && structure === "balanced") {
    // Clockwise, at the nearest place the balance leaves on the side they were dropped on.
    const other = target.children.filter((c) => c.side !== side);
    const [right, left] = side === "R" ? [sibs, other] : [other, sibs];
    line = [...right, ...[...left].reverse()];
    const ordered = side === "R" ? run : [...run].reverse();
    line.splice(balancedPlace(line, side === "R" ? i : line.length - i, ordered, side, ranges), 0, ...ordered);
  } else {
    line.splice(clearOfRanges(i, sibs, ranges, at.y), 0, ...run);
  }

  let branches = target.children.length;
  line.forEach((n, order) => {
    if (!moving.has(n.id)) {
      if (n.data.order !== order) tx.patch(n.id, { customData: { ...n.el.customData, [KEY]: { ...n.data, order } } });
      return;
    }
    if (across) moveToMap(tx, map, n, into.root.id);
    reparent(tx, n, target, order, central ? side : undefined);
    if (central) restyle(tx, map, n, 1, branchColor(branches++));
    else if (across || n.depth === 1 || mainOf(map, n) !== mainOf(into, target)) restyle(tx, map, n, target.depth + 1, branchOf(mainOf(into, target)));
  });
  if (across) layoutMap(tx, ea, into.root.id);
}

/**
 * Hands the topic with everything under it over to another map: its subtopics, connectors, summary braces,
 * boundaries and fold badges. Its own connector goes; the new map draws one to its new parent. A central topic
 * brings its whole map, and stops being one.
 */
function moveToMap(tx: SceneTx, map: MindMap, n: MMNode, rootId: string) {
  const ids = new Set(subtree(n).map((x) => x.id));
  const whole = !n.parent;
  const own = map.edges.get(n.id);
  if (own) removeEdge(tx, own);
  const frames = new Set([...map.boundaries.values()].filter((b) => ids.has(b.parent.id)).map((b) => b.id));
  for (const el of tx.live()) {
    const d = el.customData?.[KEY] as { root?: string } | undefined;
    if (!d || d.root !== map.root.id || el.id === own?.id) continue;
    const goes = whole
      || ids.has(nodeData(el)?.self ?? "")
      || ids.has(edgeData(el)?.child ?? "")
      || ids.has(braceData(el)?.summary ?? "")
      || frames.has(boundaryData(el)?.self ?? "")
      || frames.has(titleData(el)?.boundary ?? "")
      || ids.has(badgeData(el)?.node ?? "");
    if (goes) tx.patch(el.id, { customData: { ...el.customData, [KEY]: { ...d, root: rootId } } });
  }
  if (whole) {
    const { structure: _, autoAlign: __, ...rest } = nodeData(tx.get(n.id))!;
    tx.patch(n.id, { customData: { ...tx.get(n.id)!.customData, [KEY]: rest } });
  }
}

/** A topic dragged out of the frame of one or more boundaries it belongs to, with those boundaries. */
function boundaryLeaver(map: MindMap): { node: MMNode; left: MMBoundary[] } | null {
  for (const n of map.nodes.values()) {
    if (!n.parent || n.covers || isHidden(n) || !dragged(n)) continue;
    const left = n.parent.boundaries.filter((b) => b.covers.includes(n.id) && !middleIn(n.el, b.el));
    if (left.length) return { node: n, left };
  }
  return null;
}

/**
 * Topics dragged out of a boundary's frame leave the boundary: they are taken off its list and put next to
 * the topics it still encloses, after them when dropped below its middle, before them otherwise. A boundary
 * left with no topics goes; one whose frame the topic is still in keeps it. Returns the topics that left.
 */
function leaveBoundaries(tx: SceneTx, map: MindMap): string[] {
  const out: string[] = [];
  let m = map;
  // Each topic leaves at most once; the bound only guards against data that keeps a topic outside.
  for (let found = boundaryLeaver(m); found && out.length < m.nodes.size; found = boundaryLeaver(m)) {
    const { node: n, left } = found;
    out.push(n.id);
    const p = n.parent!;
    for (const b of p.boundaries) {
      if (left.includes(b)) {
        if (b.covers.every((id) => id === n.id)) deleteBoundaryEls(tx, b);
        else relist(tx, b, b.covers.filter((id) => id !== n.id));
      } else if (b.covers.includes(n.id) && !boundaryData(b.el)!.topics.includes(n.id)) {
        relist(tx, b, b.covers); // listed, it stays inside even when it moves to the end of the range
      }
    }

    // Out of the range of the widest boundary it left, which takes in the narrower ones.
    const widest = left.reduce((a, b) => (b.covers.length > a.covers.length ? b : a));
    const rest = widest.covers.filter((id) => id !== n.id);
    // And out of the summaries inside that boundary, which stay with the topics they still span there.
    for (const sm of p.summaries) {
      if (!sm.covers.includes(n.id) || sm.covers.length === 1 || !sm.covers.every((id) => widest.covers.includes(id))) continue;
      relist(tx, sm, sm.covers.filter((id) => id !== n.id));
    }
    if (rest.length) {
      const sibs = p.children.filter((c) => c.side === n.side && c !== n); // top to bottom
      const below = middle(n.el).y > middle(widest.el).y;
      const at = below ? sibs.findIndex((c) => c.id === rest[rest.length - 1]) + 1 : sibs.findIndex((c) => c.id === rest[0]);
      sibs.splice(at, 0, n);
      place(tx, [n], sibs, left);
    }
    m = buildMap(tx.live(), m.root.id)!;
  }
  return out;
}

/** A topic dragged above or below the brace of a summary it shares with other topics, with that summary. */
function summaryLeaver(map: MindMap): { node: MMNode; summary: MMSummary } | null {
  for (const n of map.nodes.values()) {
    if (!n.parent || n.covers || isHidden(n) || !dragged(n)) continue;
    const y = middle(n.el).y;
    for (const sm of n.parent.summaries) {
      const brace = map.braces.get(sm.node.id);
      if (brace && sm.covers.length > 1 && sm.covers.includes(n.id) && (y < brace.y || y > brace.y + brace.height)) return { node: n, summary: sm };
    }
  }
  return null;
}

/**
 * Topics dragged above or below the brace of a summary leave it, going right before or after the topics it
 * still spans; boundaries whose frame they are still in keep them. Returns the topics that left.
 */
function leaveSummaries(tx: SceneTx, map: MindMap): string[] {
  const out: string[] = [];
  let m = map;
  // Each topic leaves at most once; the bound only guards against data that keeps a topic outside.
  for (let found = summaryLeaver(m); found && out.length < m.nodes.size; found = summaryLeaver(m)) {
    const { node: n, summary: sm } = found;
    out.push(n.id);
    const p = n.parent!;
    const rest = sm.covers.filter((id) => id !== n.id);
    relist(tx, sm, rest);
    for (const b of p.boundaries) if (b.covers.includes(n.id) && !boundaryData(b.el)!.topics.includes(n.id)) relist(tx, b, b.covers);
    const sibs = p.children.filter((c) => c.side === n.side && c !== n); // top to bottom
    const below = middle(n.el).y > middle(m.braces.get(sm.node.id)!).y;
    const at = below ? sibs.findIndex((c) => c.id === rest[rest.length - 1]) + 1 : sibs.findIndex((c) => c.id === rest[0]);
    sibs.splice(at, 0, n);
    place(tx, [n], sibs, [sm]);
    m = buildMap(tx.live(), m.root.id)!;
  }
  return out;
}

/** A topic in no summary dragged next to the brace of a summary of its siblings, with that summary. */
function summaryJoiner(map: MindMap): { node: MMNode; summary: MMSummary } | null {
  for (const n of map.nodes.values()) {
    if (!n.parent || n.covers || isHidden(n) || !dragged(n)) continue;
    if (n.parent.summaries.some((sm) => sm.covers.includes(n.id))) continue; // summaries don't overlap
    for (const sm of n.parent.summaries) {
      const brace = map.braces.get(sm.node.id);
      const topics = sm.covers.map((id) => map.nodes.get(id)!);
      if (!brace || topics[0].side !== n.side) continue;
      // From the topics it spans across to its brace.
      const area = [brace, ...topics.map((t) => t.el)].map(boxOf).reduce((a, b) => {
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
      });
      if (middleIn(n.el, area)) return { node: n, summary: sm };
    }
  }
  return null;
}

/**
 * Topics dragged next to the brace of a summary join it: they are put among the topics it spans by height,
 * clear of boundaries they aren't in, and added to its list. Returns the topics that joined.
 */
function joinSummaries(tx: SceneTx, map: MindMap): string[] {
  const out: string[] = [];
  let m = map;
  // Each topic joins at most once; the bound only guards against data that keeps a topic inside.
  for (let found = summaryJoiner(m); found && out.length < m.nodes.size; found = summaryJoiner(m)) {
    const { node: n, summary: sm } = found;
    out.push(n.id);
    const p = n.parent!;
    const y = middle(n.el).y;
    const sibs = p.children.filter((c) => c.side === n.side && c !== n); // top to bottom
    const from = sibs.findIndex((c) => c.id === sm.covers[0]);
    const to = sibs.findIndex((c) => c.id === sm.covers[sm.covers.length - 1]);
    let at = sibs.findIndex((c, i) => i >= from && i <= to && middle(c.el).y > y);
    if (at < 0) at = to + 1;
    at = clearOfRanges(at, sibs, p.boundaries.filter((b) => !b.covers.includes(n.id)).map((b) => b.covers), y);
    sibs.splice(at, 0, n);
    reorder(tx, n, sibs);
    relist(tx, sm, [...sm.covers, n.id]);
    m = buildMap(tx.live(), m.root.id)!;
  }
  return out;
}

/** Whether the boundary or summary lists the topic, rather than spanning it for being between two it lists. */
const lists = (r: Range, id: string) => ("node" in r ? r.node.data.summary! : boundaryData(r.el)!.topics).includes(id);

/**
 * In an auto-aligned map, the topics dragged on their own go among their siblings by height. They stay
 * within the boundaries and summaries they are in, and out of those they aren't.
 */
function reorderDropped(tx: SceneTx, map: MindMap) {
  if (!autoAligned(map.root.data)) return;
  const ids = [...map.nodes.values()].filter((n) => n.parent && !n.covers && !isHidden(n) && dragged(n)).map((n) => n.id);
  let m = map;
  for (const id of ids) {
    const n = m.nodes.get(id)!;
    const p = n.parent!;
    const y = middle(n.el).y;
    const sibs = p.children.filter((c) => c.side === n.side && c !== n); // top to bottom
    const index = (cid: string) => sibs.findIndex((c) => c.id === cid);
    let at = sibs.findIndex((c) => middle(c.el).y > y);
    if (at < 0) at = sibs.length;
    // Within the narrowest range it shares with other topics, listed so its end keeps it in.
    const mine = rangesOf(p).filter((r) => r.covers.includes(n.id) && r.covers.length > 1);
    for (const r of mine) if (!lists(r, n.id)) relist(tx, r, r.covers);
    if (mine.length) {
      const inner = mine.reduce((a, b) => (b.covers.length < a.covers.length ? b : a)).covers.filter((c) => c !== n.id);
      at = Math.min(Math.max(at, index(inner[0])), index(inner[inner.length - 1]) + 1);
    }
    at = clearOfRanges(at, sibs, rangesOf(p).filter((r) => !r.covers.includes(n.id)).map((r) => r.covers), y);
    sibs.splice(at, 0, n);
    place(tx, [n], sibs);
    m = buildMap(tx.live(), m.root.id)!;
  }
}

/** Orders the topic's siblings on its side as given, top to bottom, in the line their orders place them in. */
function reorder(tx: SceneTx, n: MMNode, sibs: MMNode[]) {
  // The line holds this side's topics in slots of its own, bottom to top when reversed.
  const { line, reversed } = orderLine(n);
  const slots = line.flatMap((c, i) => (c.side === n.side ? [i] : []));
  const shown = reversed ? [...sibs].reverse() : sibs;
  slots.forEach((i, k) => (line[i] = shown[k]));
  renumber(tx, line);
}

/**
 * Puts the topics, one or a run of them, among their siblings on their side as given, top to bottom. Main
 * topics of a balanced map in no range with other topics (once out of those they are leaving) could be sent
 * to the other side by the balance, so they go to the nearest place that keeps them on their side instead.
 */
function place(tx: SceneTx, group: MMNode[], sibs: MMNode[], leaving: Range[] = []) {
  const n = group[0];
  const p = n.parent!;
  const inGroup = (id: string) => group.some((g) => g.id === id);
  const covers = rangesOf(p).map((r) => (leaving.includes(r) ? r.covers.filter((id) => !inGroup(id)) : r.covers));
  const enclosed = covers.some((c) => c.length > group.length && group.every((g) => c.includes(g.id)));
  if (p.parent || structureOf(p) !== "balanced" || enclosed) return reorder(tx, n, sibs);
  const other = p.children.filter((c) => c.side !== n.side);
  const [right, left] = n.side === "R" ? [sibs, other] : [other, sibs];
  const line = [...right, ...[...left].reverse()]; // clockwise
  const run = line.filter((c) => group.includes(c));
  const rest = line.filter((c) => !group.includes(c));
  const ranges = covers.filter((c) => !c.some(inGroup));
  rest.splice(balancedPlace(rest, line.indexOf(run[0]), run, n.side as Side, ranges), 0, ...run);
  renumber(tx, rest);
}

/**
 * Where in a balanced map's clockwise line main topics go, one or a run of them kept together: the place
 * given, or the nearest one where the balance leaves them on the given side; never inside a range of topics
 * they aren't in.
 */
function balancedPlace(line: MMNode[], at: number, run: MMNode[], side: Side, ranges: string[][]): number {
  const inside = rangesIn(line, ranges);
  const together = [...ranges, run.map((n) => n.id)];
  const fits = (i: number) => {
    if (inside.some(([from, to]) => from < i && i <= to)) return false;
    const l = [...line.slice(0, i), ...run, ...line.slice(i)];
    const split = balancedSplit(l.length, rangesIn(l, together));
    return side === "R" ? i + run.length <= split : i >= split;
  };
  for (let d = 0; d <= line.length; d++) for (const i of [at - d, at + d]) if (i >= 0 && i <= line.length && fits(i)) return i;
  return at;
}

/** A topic dragged into the frame of one or more boundaries around its siblings, with those boundaries. */
function boundaryJoiner(map: MindMap): { node: MMNode; join: MMBoundary[] } | null {
  for (const n of map.nodes.values()) {
    if (!n.parent || n.covers || isHidden(n) || !dragged(n)) continue;
    const join = n.parent.boundaries.filter(
      (b) => !b.covers.includes(n.id) && map.nodes.get(b.covers[0])?.side === n.side && middleIn(n.el, b.el),
    );
    if (join.length) return { node: n, join };
  }
  return null;
}

/**
 * Topics dragged into the frame of a boundary around their siblings join it: they are put among the topics
 * it encloses by height and added to its list. Returns the topics that joined.
 */
function joinBoundaries(tx: SceneTx, map: MindMap): string[] {
  const out: string[] = [];
  let m = map;
  // Each topic joins at most once; the bound only guards against data that keeps a topic inside.
  for (let found = boundaryJoiner(m); found && out.length < m.nodes.size; found = boundaryJoiner(m)) {
    const { node: n, join } = found;
    out.push(n.id);
    const p = n.parent!;
    const cy = (c: MMNode) => middle(c.el).y;
    const sibs = p.children.filter((c) => c.side === n.side && c !== n); // top to bottom
    const range = (ids: string[]) => ({ from: sibs.findIndex((c) => c.id === ids[0]), to: sibs.findIndex((c) => c.id === ids[ids.length - 1]) });

    // By height within the narrowest boundary it joins, which the wider ones take in.
    const narrowest = join.reduce((a, b) => (b.covers.length < a.covers.length ? b : a));
    const r = range(narrowest.covers);
    let at = sibs.findIndex((c, i) => i >= r.from && i <= r.to && cy(c) > cy(n));
    if (at < 0) at = r.to + 1;
    // Not inside the range of a boundary it isn't joining, or of a summary.
    const others = rangesOf(p).filter((o) => !join.includes(o as MMBoundary) && !o.covers.includes(n.id));
    at = clearOfRanges(at, sibs, others.map((o) => o.covers), cy(n));
    sibs.splice(at, 0, n);
    reorder(tx, n, sibs);
    for (const b of join) relist(tx, b, [...b.covers, n.id]);
    m = buildMap(tx.live(), m.root.id)!;
  }
  return out;
}

/**
 * Main topics of a two-sided map dragged across the central topic change sides, going among the topics
 * there by height. In a free map that is their side from now on; in a balanced one they get the place
 * in the order that puts them on that side. Returns the topics that changed sides.
 */
function crossSides(tx: SceneTx, map: MindMap): string[] {
  const structure = structureOf(map.root);
  const crossed = crossedTopics(map);
  if (!crossed.length) return [];
  const cy = (n: MMNode) => middle(n.el).y;
  const isCrossed = (id: string) => crossed.some((c) => c.id === id);

  // It leaves the summaries it shares with topics staying behind; a summary of only crossing topics goes along.
  for (const sm of map.root.summaries) {
    const staying = sm.covers.filter((id) => !isCrossed(id));
    if (staying.length && staying.length < sm.covers.length) relist(tx, sm, staying);
  }
  // The ranges of topics that stay where they are, which a topic coming over doesn't join.
  const ranges = rangesOf(map.root).map((r) => r.covers.filter((id) => !isCrossed(id))).filter((c) => c.length);

  // Topics crossing with all the others of a boundary or summary go over as one run, keeping it whole.
  const runs: MMNode[][] = [];
  for (const n of [...crossed].sort((a, b) => cy(a) - cy(b))) {
    if (runs.some((r) => r.includes(n))) continue;
    const whole = rangesOf(map.root).map((r) => r.covers).filter((c) => c.includes(n.id) && c.every(isCrossed));
    runs.push(whole.reduce((a, b) => (b.length > a.length ? b : a), [n.id]).map((id) => map.nodes.get(id)!));
  }

  const target = (n: MMNode): Side => (crossed.includes(n) ? (n.side === "L" ? "R" : "L") : (n.side as Side));
  const side = (s: Side) => {
    const line = map.root.children.filter((n) => !crossed.includes(n) && n.side === s);
    for (const run of runs.filter((r) => target(r[0]) === s)) {
      const i = line.findIndex((m) => cy(m) > cy(run[0]));
      line.splice(clearOfRanges(i < 0 ? line.length : i, line, ranges, cy(run[0])), 0, ...run);
    }
    return line;
  };
  const right = side("R");
  const left = side("L");
  if (structure === "free") {
    for (const line of [right, left]) renumber(tx, line, (n) => (crossed.includes(n) ? { side: target(n) } : {}));
    return crossed.map((n) => n.id);
  }

  // Clockwise, the first half of the order goes right. Each run goes to the place nearest where it was dropped
  // that the balance leaves on its new side.
  let line = [...right, ...left.reverse()];
  for (const run of runs) {
    const ordered = line.filter((c) => run.includes(c));
    const rest = line.filter((c) => !run.includes(c));
    rest.splice(balancedPlace(rest, line.indexOf(ordered[0]), ordered, target(run[0]), ranges), 0, ...ordered);
    line = rest;
  }
  renumber(tx, line);
  return crossed.map((n) => n.id);
}

/** Scene-space box of an element. */
const boxOf = (el: El): Box => ({ x: el.x, y: el.y, w: el.width, h: el.height });

/**
 * Re-routes the relationships touching the map between their topics, keeping the bend they have,
 * and moves their labels along. They are hidden while either topic is, and go when either is gone.
 */
function layoutRelations(tx: SceneTx, map: MindMap) {
  for (const el of tx.live()) {
    const stored = relationData(el);
    const d = stored && relationEnds(tx, el, stored);
    if (!d || !inMap(map, d)) continue;
    const a = tx.get(d.from);
    const b = tx.get(d.to);
    const valid = (x: El | undefined): x is El => !!x && !x.isDeleted && (!!nodeData(x) || !!boundaryData(x));
    if (!valid(a) || !valid(b) || a === b) {
      deleteWithText(tx, el);
      continue;
    }
    const label = labelOf(tx, el);
    const hidden = !!a.customData?.[HIDDEN_KEY] || !!b.customData?.[HIDDEN_KEY];
    if (!hidden) routeRelation(tx, el, label, a, b);
    setHidden(tx, el.id, hidden);
    if (label) setHidden(tx, label.id, hidden);
  }
}

/** Whether either end of the relationship is a topic or boundary of the map. */
const inMap = (map: MindMap, d: RelationData) =>
  map.nodes.has(d.from) || map.nodes.has(d.to) || map.boundaries.has(d.from) || map.boundaries.has(d.to);

/**
 * The topics or boundaries a relationship runs between. When the user has bound an end to another one,
 * that one, stored from now on; an end bound to anything else keeps what it had. An end bound to a
 * boundary's title is glued to its frame instead, which the relationship is routed to.
 */
function relationEnds(tx: SceneTx, el: El, d: RelationData): RelationData {
  const end = (key: "startBinding" | "endBinding", cur: string) => {
    const b = tx.get(el.id)![key];
    const t = b ? relationEnd(tx.get(b.elementId), (id) => tx.get(id)) : null;
    if (!b || !t) return cur;
    if (t.id !== b.elementId) {
      tx.patch(el.id, { [key]: { ...b, elementId: t.id } });
      removeBound(tx, b.elementId, el.id);
      addBound(tx, t.id, el.id);
    }
    return t.id;
  };
  const from = end("startBinding", d.from);
  const to = end("endBinding", d.to);
  if ((from === d.from && to === d.to) || from === to) return d;
  const ends = { ...d, from, to };
  tx.patch(el.id, { customData: { ...tx.get(el.id)!.customData, [KEY]: ends } });
  return ends;
}

/** The relationship's label. One Excalidraw just added gets the label color once; later the user's color stays. */
function labelOf(tx: SceneTx, el: El): El | null {
  const tid = boundTextId(el);
  const t = tid ? tx.get(tid) : undefined;
  if (!t || t.isDeleted) return null;
  if (!isRelationLabel(t))
    tx.patch(t.id, { strokeColor: relationshipColors().text, customData: { ...t.customData, [KEY]: { relationLabel: true } } });
  return tx.get(t.id)!;
}

/**
 * Runs the relationship from topic a to topic b with its stored bend, its label on the middle point.
 * The bend is never read back from the drawn points here: Excalidraw moves the ends of a bound arrow
 * on its own, so the points may be distorted.
 */
function routeRelation(tx: SceneTx, el: El, label: El | null, a: El, b: El) {
  const { start, mid, end } = relationPoints(boxOf(a), boxOf(b), relationData(el)?.bend ?? RELATION_BEND);
  const pts = [[0, 0], [mid.x - start.x, mid.y - start.y], [end.x - start.x, end.y - start.y]];
  const cur = el.points;
  const same = near(el.x, start.x) && near(el.y, start.y) && cur?.length === 3 &&
    pts.every((p, i) => near(cur[i][0], p[0]) && near(cur[i][1], p[1]));
  if (!same) {
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    tx.patch(el.id, {
      x: start.x, y: start.y, points: pts,
      width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys),
    });
  }
  // Excalidraw centers a label on the middle point of a three-point arrow.
  if (label && (!near(label.x, mid.x - label.width / 2) || !near(label.y, mid.y - label.height / 2)))
    tx.patch(label.id, { x: mid.x - label.width / 2, y: mid.y - label.height / 2 });
}

/**
 * Keeps relationships on their topics when Excalidraw moves the topics itself, while dragging or on undo:
 * re-routes the visible ones that no longer run between their topics. A selected relationship is left
 * to the user instead, and the curve they give its middle point becomes its bend.
 * Not an undo step of its own, the topics' move is.
 */
export function followRelations(view: ExcalidrawView) {
  const api = view.excalidrawAPI;
  if (!api) return;
  const els = api.getSceneElements();
  if (!els.some((e) => relationData(e))) return;
  const sel = api.getAppState().selectedElementIds ?? {};
  const tx = new SceneTx(view);
  for (const el of els) {
    const stored = relationData(el);
    if (!stored || el.customData?.[HIDDEN_KEY]) continue;
    const d = relationEnds(tx, el, stored);
    if (sel[el.id]) {
      labelOf(tx, el);
      const bend = relationBend(el.points ?? []);
      if (bend !== null && !near(bend, d.bend ?? RELATION_BEND))
        tx.patch(el.id, { customData: { ...tx.get(el.id)!.customData, [KEY]: { ...d, bend } } });
      continue;
    }
    const a = tx.get(d.from);
    const b = tx.get(d.to);
    if (!a || a.isDeleted || !b || b.isDeleted || a === b) continue; // the next layout deletes it
    routeRelation(tx, el, labelOf(tx, el), a, b);
  }
  tx.commit("NEVER");
}

/** Draws a relationship from one topic or boundary to another, like XMind's Relationship, and selects it. */
export async function addRelationship(view: ExcalidrawView, fromId: string, toId: string) {
  const id = run(view, (tx, ea) => {
    const get = (i: string) => tx.get(i);
    const a = relationEnd(tx.get(fromId), get);
    const b = relationEnd(tx.get(toId), get);
    if (!a || !b || a === b) return null;
    fromId = a.id;
    toId = b.id;
    const { start, mid, end } = relationPoints(boxOf(a), boxOf(b), RELATION_BEND);
    ea.clear();
    Object.assign(ea.style, {
      strokeColor: relationshipColors().line,
      strokeWidth: 1.5,
      strokeStyle: "dashed",
      roughness: a.roughness,
      roundness: { type: 2 }, // smooth curve through the points
      opacity: 100,
    });
    const id = ea.addArrow([[start.x, start.y], [mid.x, mid.y], [end.x, end.y]], {
      startArrowHead: null,
      endArrowHead: "arrow",
      startObjectId: fromId,
      endObjectId: toId,
    });
    const el = ea.getElement(id);
    el.customData = { [KEY]: { relation: true, self: id, from: fromId, to: toId, bend: RELATION_BEND } };
    tx.add(el);
    addBound(tx, fromId, id);
    addBound(tx, toId, id);
    ea.clear();
    return id;
  });
  if (!id) return;
  await nextFrame();
  select(view, id);
}

/** Puts the badge with the count of hidden topics just outside the folded topic, creating or updating it. */
function placeBadge(tx: SceneTx, ea: ExcalidrawAutomate, rootId: string, n: MMNode, box: Box, badge: MMBadge | undefined) {
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
  const c = n.el.strokeColor;
  const color = el.backgroundColor === c && el.strokeColor === c ? {} : { backgroundColor: c, strokeColor: c };
  placeBox(tx, el, text, { x, y: box.y + box.h / 2 - s.h / 2, w, h: s.h }, s, BADGE_PADDING, color);
}

/** Runs a mind map mutation in one transaction and one undo step. */
function run<T>(view: ExcalidrawView, fn: (tx: SceneTx, ea: ExcalidrawAutomate) => T): T | null {
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
  const pts = el.points;
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
  const id = run(view, (tx, ea) => createMap(tx, ea));
  if (id) await focusNode(view, id, true);
}

/** Adds a new map at a free spot in view, its central topic with the text and subtopics given; returns the central topic. */
function createMap(tx: SceneTx, ea: ExcalidrawAutomate, text?: string, items: OutlineItem[] = []): string {
  const st = tx.api.getAppState();
  const z = st.zoom?.value ?? 1;
  const visible: Box = { x: -st.scrollX, y: -st.scrollY, w: st.width / z, h: st.height / z };
  const obstacles = tx.live().filter((e) => !e.customData?.[HIDDEN_KEY]).map(boundsOf);
  const c = findFreeSpot(visible, obstacles, NEW_MAP_AREA, NEW_MAP_GAP);
  const id = createNode(tx, ea, {
    depth: 0,
    branch: branchColor(0),
    text,
    data: { root: "", parent: null, order: 0, ...newMapDefaults() },
    at: { x: c.x - 90, y: c.y - 30 },
    fontFamily: st.currentItemFontFamily,
    roughness: st.currentItemRoughness,
  });
  if (items.length) {
    const found = mapOf(tx, id)!;
    addOutline(tx, ea, found.map, found.node, items);
  }
  layoutMap(tx, ea, id);
  return id;
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
      // By the stored sides, so a map made one-sided comes out balanced when it is made free.
      const right = node.children.filter((c) => (c.data.side ?? "R") === "R").length;
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
    const { line, reversed } = orderLine(node);
    const after = above === reversed; // below comes later in the order, unless the line runs bottom to top
    const i = line.indexOf(node);
    const neighbour = after ? line[i + 1] : line[i - 1];
    const order = neighbour ? (node.data.order + neighbour.data.order) / 2 : node.data.order + (after ? 1 : -1);
    const id = createNode(tx, ea, {
      depth: node.depth,
      branch: node.depth === 1 ? branchColor(parent.children.length) : branchOf(node),
      data: { root: map.root.id, parent: parent.id, order, ...(node.depth === 1 ? { side: node.data.side ?? (node.side as Side) } : {}) },
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
    // Relationships go with the topic, other arrows that pointed at it are unbound.
    for (const b of x.el.boundElements ?? []) {
      const a = tx.get(b.id);
      if (b.type !== "arrow" || !a || a.isDeleted || edgeData(a)) continue;
      if (relationData(a)) {
        deleteWithText(tx, a);
        continue;
      }
      const p: Partial<El> = {};
      if (a.startBinding?.elementId === x.id) p.startBinding = null;
      if (a.endBinding?.elementId === x.id) p.endBinding = null;
      tx.patch(a.id, p);
    }
  }
}

/** Whether the topic is a central topic with no other topics in its map, which can always be deleted. */
export function isLoneCentral(view: ExcalidrawView, nodeId: string): boolean {
  const els = view.excalidrawAPI?.getSceneElements() ?? [];
  return nodeData(els.find((e) => e.id === nodeId))?.parent === null && buildMap(els, nodeId)?.nodes.size === 1;
}

/** Deletes the node with its subtopics; the central topic only when allowRoot or it is alone in its map, taking the whole map with it. */
export function deleteNode(view: ExcalidrawView, nodeId: string, allowRoot: boolean) {
  return deleteNodes(view, [nodeId], allowRoot);
}

/** Deletes the nodes with their subtopics in one undo step, then selects a topic next to the last one. */
export async function deleteNodes(view: ExcalidrawView, nodeIds: string[], allowRoot: boolean) {
  const next = run(view, (tx, ea) => {
    let next: string | null = null;
    // Alone before anything is deleted: deleting its topics first doesn't get a central topic past the setting.
    const alone = new Set(nodeIds.filter((id) => mapOf(tx, id)?.map.nodes.size === 1));
    for (const id of nodeIds) {
      const found = mapOf(tx, id); // nothing when it went with an earlier one
      if (found) next = removeTopic(tx, ea, found.map, found.node, allowRoot || alone.has(id)) ?? next;
    }
    return next && !tx.get(next)?.isDeleted ? next : null;
  });
  if (next) await focusNode(view, next, false);
}

/** Deletes the node with its subtopics in the transaction; returns the topic to select next. */
function removeTopic(tx: SceneTx, ea: ExcalidrawAutomate, map: MindMap, node: MMNode, allowRoot: boolean): string | null {
  if (!node.parent) {
    if (!allowRoot) {
      new Notice("Deleting the central topic is disabled. Enable it in the plugin settings.");
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
}

/** Moves the node one position up or down among its siblings on the same side, like Alt+Up/Down in XMind. */
export async function moveNode(view: ExcalidrawView, nodeId: string, up: boolean) {
  const moved = run(view, (tx, ea) => {
    const found = mapOf(tx, nodeId);
    if (!found?.node.parent || found.node.covers || !moveRun(tx, [found.node], up)) return false;
    layoutMap(tx, ea, found.map.root.id);
    return true;
  });
  if (moved) await focusNode(view, nodeId, false);
}

/** Moves the boundary with its topics one place up or down among their siblings, like Alt+Up/Down on a topic. */
export async function moveBoundary(view: ExcalidrawView, boundaryId: string, up: boolean) {
  const moved = run(view, (tx, ea) => {
    const root = rootIdOf(tx.get(boundaryId));
    const map = root ? buildMap(tx.live(), root) : null;
    const b = map?.boundaries.get(boundaryId);
    if (!map || !b || !moveRun(tx, b.covers.map((id) => map.nodes.get(id)!), up)) return false;
    layoutMap(tx, ea, map.root.id);
    return true;
  });
  if (moved) await focusNode(view, boundaryId, false);
}

/**
 * Moves topics, one or a run of them top to bottom, one place up or down among their siblings. It never changes
 * what they belong to: they stop at the end of a boundary or summary around them, and move past one they aren't
 * in as a whole. Dragging takes them in or out. False when they can't move.
 */
function moveRun(tx: SceneTx, run: MMNode[], up: boolean): boolean {
  const p = run[0].parent!;
  const ids = new Set(run.map((n) => n.id));
  const sibs = p.children.filter((c) => c.side === run[0].side); // top to bottom
  const ranges = rangesOf(p).filter((r) => sibs.some((c) => c.id === r.covers[0]));
  const front = (covers: string[]) => covers[up ? 0 : covers.length - 1]; // the end it moves toward
  const back = (covers: string[]) => covers[up ? covers.length - 1 : 0];
  const lead = front(run.map((n) => n.id));

  const around = ranges.filter((r) => r.covers.length > ids.size && [...ids].every((id) => r.covers.includes(id)));
  if (around.some((r) => front(r.covers) === lead)) return false;
  const other = sibs[sibs.findIndex((c) => c.id === lead) + (up ? -1 : 1)];
  if (!other) return false;
  const blocks = ranges.filter((r) => !r.covers.some((id) => ids.has(id)) && back(r.covers) === other.id);
  const widest = blocks.reduce<Range | null>((a, b) => (!a || b.covers.length > a.covers.length ? b : a), null);
  const past = widest ? front(widest.covers) : other.id;
  // Listed, so they stay in at the end of a range around them.
  for (const r of around) if (![...ids].every((id) => lists(r, id))) relist(tx, r, r.covers);
  const rest = sibs.filter((c) => !ids.has(c.id));
  const k = rest.findIndex((c) => c.id === past);
  rest.splice(up ? k : k + 1, 0, ...run);
  place(tx, run, rest);
  return true;
}

/**
 * Whether the nodes can get a summary or a boundary: one or more siblings on the same side,
 * not the central topic or a summary.
 */
export function areSiblingTopics(view: ExcalidrawView, nodes: El[]): boolean {
  const ds = nodes.map(nodeData);
  const first = ds[0];
  if (!first || ds.some((d) => !d || d.parent === null || d.summary)) return false;
  if (!ds.every((d) => d!.root === first.root && d!.parent === first.parent)) return false;
  if (first.parent !== first.root || nodes.length === 1) return true;
  // Main topics: by the sides they are shown on.
  const map = buildMap(view.excalidrawAPI?.getSceneElements() ?? [], first.root);
  const sides = nodes.map((n) => map?.nodes.get(n.id)?.side);
  return !!sides[0] && sides.every((s) => s === sides[0]);
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
    const els = createBoundary(ea, map.root.id, parent.id, ids, covered[0]);
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

export interface TopicState {
  foldable: boolean; // can be collapsed or expanded
  collapsed: boolean;
  promote: boolean; // can be promoted to its parent's level
  demote: boolean; // can be demoted under the sibling above
}

/** What the fold, promote and demote commands can do with the node. */
export function topicState(view: ExcalidrawView, nodeId: string): TopicState {
  const els = view.excalidrawAPI?.getSceneElements() ?? [];
  const d = nodeData(els.find((e) => e.id === nodeId));
  const n = d ? buildMap(els, d.root)?.nodes.get(nodeId) : undefined;
  if (!n) return { foldable: false, collapsed: false, promote: false, demote: false };
  const f = foldable(n);
  return { foldable: f, collapsed: f && collapsed(n), promote: canPromote(n), demote: canDemote(n) };
}

/** Whether the node can be collapsed or expanded, and whether it is collapsed now. */
export function foldState(view: ExcalidrawView, nodeId: string): { foldable: boolean; collapsed: boolean } {
  const els = view.excalidrawAPI?.getSceneElements() ?? [];
  const d = nodeData(els.find((e) => e.id === nodeId));
  const n = d ? buildMap(els, d.root)?.nodes.get(nodeId) : undefined;
  return n && foldable(n) ? { foldable: true, collapsed: collapsed(n) } : { foldable: false, collapsed: false };
}

/** Folds or unfolds every topic with subtopics in the node's subtree, the node included. */
function foldSubtree(tx: SceneTx, ea: ExcalidrawAutomate, map: MindMap, node: MMNode, folded: boolean) {
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

// ---------- promote and demote ----------

/** The sibling right above the node on its side. */
function siblingAbove(n: MMNode): MMNode | undefined {
  const sibs = n.parent!.children.filter((c) => c.side === n.side);
  return sibs[sibs.indexOf(n) - 1];
}

// Summaries have no siblings to move among.
const canPromote = (n: MMNode) => !n.covers && !!n.parent?.parent;
const canDemote = (n: MMNode) => !n.covers && !!n.parent && !!siblingAbove(n);

/** Summaries and boundaries of the node's parent that span only the node go, like when it is deleted. */
function leaveRanges(tx: SceneTx, map: MindMap, node: MMNode) {
  const p = node.parent!;
  for (const s of p.summaries) if (s.covers.length === 1 && s.covers[0] === node.id) deleteSubtree(tx, map, s.node);
  for (const b of p.boundaries) if (b.covers.length === 1 && b.covers[0] === node.id) deleteBoundaryEls(tx, b);
}

/** Moves the node under a new parent; a manual offset from its old place would make no sense there. */
function reparent(tx: SceneTx, node: MMNode, parent: MMNode, order: number, side?: Side) {
  const el = tx.get(node.id)!;
  const { side: _, ox, oy, lx, ly, ...rest } = nodeData(el)!;
  tx.patch(node.id, { customData: { ...el.customData, [KEY]: { ...rest, parent: parent.id, order, ...(side ? { side } : {}) } } });
}

/**
 * Gives a topic moved to another level the look of its new one, and its subtree that branch's color. Topics under it
 * that cross the main-topic line with it (a central topic becoming a subtopic) take the look of their new level too.
 */
function restyle(tx: SceneTx, map: MindMap, node: MMNode, depth: number, branch: Branch) {
  const level = (d: number) => Math.min(d, 2);
  const look = (x: MMNode, d: number) => {
    const st = styleFor(d, branch);
    tx.patch(x.id, { strokeColor: st.borderColor, backgroundColor: st.backgroundColor, strokeWidth: st.strokeWidth });
    if (x.text) tx.patch(x.text.id, { fontSize: st.fontSize, strokeColor: st.textColor });
  };
  look(node, depth);
  for (const x of subtree(node)) {
    if (x === node) continue;
    const d = x.depth + depth - node.depth;
    const relevel = level(d) !== level(x.depth);
    if (relevel && !x.data.summary) look(x, d);
    else if (!x.data.summary) tx.patch(x.id, { strokeColor: branch.stroke }); // summaries keep their own colors
    const edge = map.edges.get(x.id);
    if (edge) tx.patch(edge.id, { strokeColor: branch.stroke, ...(relevel ? { strokeWidth: d === 1 ? 2 : 1.5 } : {}) });
  }
}

/** Makes the topic, with its subtree, a sibling of its parent, right after it. A main topic stays where it is. */
export async function promote(view: ExcalidrawView, nodeId: string) {
  const done = run(view, (tx, ea) => {
    const found = mapOf(tx, nodeId);
    if (!found || !canPromote(found.node)) return false;
    const { map, node } = found;
    const parent = node.parent!;
    const target = parent.parent!;
    // Under a summary, the topic lands after the last topic the summary spans.
    const anchor = parent.covers ? map.nodes.get(parent.covers[parent.covers.length - 1])! : parent;
    const { line, reversed } = orderLine(anchor);
    const i = line.indexOf(anchor);
    const next = reversed ? line[i - 1] : line[i + 1]; // the topic below the anchor
    const order = next ? (anchor.data.order + next.data.order) / 2 : anchor.data.order + (reversed ? -1 : 1);
    leaveRanges(tx, map, node);
    if (target === map.root) {
      reparent(tx, node, target, order, anchor.data.side ?? (anchor.side as Side));
      restyle(tx, map, node, 1, branchColor(target.children.length));
    } else {
      reparent(tx, node, target, order);
    }
    // Next to the anchor, it joins the boundaries and summaries the anchor is in, except the summary it came from.
    for (const r of rangesOf(target)) if (r.covers.includes(anchor.id) && !("node" in r && r.node === parent)) relist(tx, r, [...r.covers, node.id]);
    layoutMap(tx, ea, map.root.id);
    return true;
  });
  if (done) await focusNode(view, nodeId, false);
}

/** Makes the topic, with its subtree, the last subtopic of the sibling above it. */
export async function demote(view: ExcalidrawView, nodeId: string) {
  const done = run(view, (tx, ea) => {
    const found = mapOf(tx, nodeId);
    if (!found || !canDemote(found.node)) return false;
    const { map, node } = found;
    const target = siblingAbove(node)!;
    const order = target.children.length ? Math.max(...target.children.map((c) => c.data.order)) + 1 : 0;
    leaveRanges(tx, map, node);
    setFolded(tx, target, false); // keep the moved topic in view
    reparent(tx, node, target, order);
    if (node.depth === 1) restyle(tx, map, node, 2, branchOf(target));
    layoutMap(tx, ea, map.root.id);
    return true;
  });
  if (done) await focusNode(view, nodeId, false);
}

/** Alt+Left/Right: away from the central topic demotes, toward it promotes, so the left side is mirrored. */
export function changeLevel(view: ExcalidrawView, nodeId: string, dir: "left" | "right") {
  const els = view.excalidrawAPI?.getSceneElements() ?? [];
  const d = nodeData(els.find((e) => e.id === nodeId));
  const side = d ? buildMap(els, d.root)?.nodes.get(nodeId)?.side : null;
  if (!side) return;
  return (side === "R") === (dir === "right") ? demote(view, nodeId) : promote(view, nodeId);
}

// ---------- duplicate ----------

// The look a copy takes from its original; not opacity, lock or link, which a collapsed topic hides it by.
const LOOK = ["strokeColor", "backgroundColor", "fillStyle", "strokeWidth", "strokeStyle", "roughness", "roundness"];
const TEXT_LOOK = ["strokeColor", "fontSize", "fontFamily", "textAlign", "verticalAlign"];

const lookOf = (el: El, keys: string[]): Partial<El> => {
  const from = el as unknown as Record<string, unknown>;
  return Object.fromEntries(keys.filter((k) => k in from).map((k) => [k, from[k]]));
};

/**
 * Copies the topic with everything under it: subtopics, summaries and boundaries, with their texts, looks, collapsed
 * topics and moves. Under the given parent of the map, or as the central topic of a new map when parentId is null.
 * Relationships stay with the original. Returns the copy.
 */
function copyBranch(tx: SceneTx, ea: ExcalidrawAutomate, map: MindMap, n: MMNode, parentId: string | null, data: Partial<NodeData>, at: Vec): string {
  const ids = new Map<string, string>(); // original -> copy
  let root = parentId === null ? "" : map.root.id;
  for (const x of subtree(n)) {
    const top = x === n;
    const { self: _, lx, ly, ox, oy, ...rest } = x.data;
    const id = createNode(tx, ea, {
      depth: x.depth,
      branch: branchOf(x),
      text: topicText(x),
      data: {
        ...rest,
        root,
        parent: top ? parentId : ids.get(x.parent!.id)!,
        ...(top ? data : { ox, oy }), // under the copy, topics keep their manual moves
        ...(x.data.summary ? { summary: x.data.summary.flatMap((s) => ids.get(s) ?? []) } : {}),
      },
      at,
      fontFamily: x.text?.fontFamily ?? 1,
      roughness: x.el.roughness,
    });
    ids.set(x.id, id);
    root ||= id;
    tx.patch(id, lookOf(x.el, LOOK));
    const tid = boundTextId(tx.get(id)!);
    if (tid && x.text) tx.patch(tid, lookOf(x.text, TEXT_LOOK));
  }
  for (const b of map.boundaries.values()) {
    const parent = ids.get(b.parent.id);
    const topics = boundaryData(b.el)!.topics.flatMap((id) => ids.get(id) ?? []);
    if (!parent || !topics.length) continue;
    const els = createBoundary(ea, root, parent, topics, map.nodes.get(b.covers[0])!);
    Object.assign(els[0], lookOf(b.el, LOOK));
    if (b.title) Object.assign(els[1], lookOf(b.title, LOOK));
    const title = b.titleText?.rawText ?? b.titleText?.originalText ?? b.titleText?.text;
    if (b.titleText && title !== undefined) Object.assign(els[2], { ...lookOf(b.titleText, TEXT_LOOK), text: title, originalText: title, rawText: title });
    tx.insert(els, tx.indexOf(b.id)); // behind the topics, like the original
  }
  return ids.get(n.id)!;
}

/**
 * Duplicates the topics with everything under them, like XMind's Duplicate: each copy goes right below its original,
 * in the boundaries and summaries the original is in. A central topic duplicates its whole map, next to it.
 * Summaries are skipped, and a topic under another one given goes along with that one. Returns the copies.
 */
function duplicate(tx: SceneTx, ea: ExcalidrawAutomate, nodeIds: string[]): string[] {
  const copies: string[] = [];
  const found = nodeIds.map((id) => mapOf(tx, id)).filter((f): f is { map: MindMap; node: MMNode } => !!f && !f.node.covers);
  const tops = found.filter((f) => !found.some((o) => o !== f && o.map.root.id === f.map.root.id && o.node !== f.node && subtree(o.node).includes(f.node)));
  for (const { node: original } of tops) {
    const { map, node } = mapOf(tx, original.id)!; // as the copies made so far left it
    if (!node.parent) {
      // A whole map, right of everything it takes up.
      const boxes = [...map.nodes.values()].filter((x) => !isHidden(x)).map((x) => boxOf(x.el));
      const left = Math.min(...boxes.map((b) => b.x));
      const right = Math.max(...boxes.map((b) => b.x + b.w));
      const id = copyBranch(tx, ea, map, node, null, {}, { x: node.el.x + right - left + 2 * NEW_MAP_GAP, y: node.el.y });
      layoutMap(tx, ea, id);
      copies.push(id);
      continue;
    }
    const parent = node.parent;
    const { line, reversed } = orderLine(node);
    const i = line.indexOf(node);
    const below = reversed ? line[i - 1] : line[i + 1];
    const order = below ? (node.data.order + below.data.order) / 2 : node.data.order + (reversed ? -1 : 1);
    const side = node.depth === 1 ? { side: node.data.side ?? (node.side as Side) } : {};
    const id = copyBranch(tx, ea, map, node, parent.id, { order, ...side }, { x: node.el.x, y: node.el.y + node.el.height + 10 });
    for (const r of rangesOf(parent)) if (r.covers.includes(node.id)) relist(tx, r, [...r.covers, id]);
    layoutMap(tx, ea, map.root.id);
    copies.push(id);
  }
  return copies;
}

/** Duplicates the topics in one undo step and selects the copies. */
export async function duplicateNodes(view: ExcalidrawView, nodeIds: string[]) {
  const copies = run(view, (tx, ea) => duplicate(tx, ea, nodeIds)) ?? [];
  if (!copies.length) return;
  await nextFrame();
  if (copies.length === 1) return select(view, copies[0]);
  const ea = getEA(view);
  ea?.selectElementsInView(copies);
  ea?.destroy?.();
}

// ---------- markdown outlines ----------

// The Excalidraw plugin keeps the Markdown source, with [[links]], in rawText and shows it parsed.
const topicText = (n: MMNode) => n.text?.rawText ?? n.text?.originalText ?? n.text?.text ?? "";

/**
 * Subtopics top to bottom; for the central topic the right side first, or clockwise in a balanced map
 * so they paste back the same. Summaries are left out.
 */
const ordered = (n: MMNode) =>
  n.parent ? n.children
  : structureOf(n) === "balanced" ? [...n.children].sort(byOrder)
  : [...n.children.filter((c) => c.side !== "L"), ...n.children.filter((c) => c.side === "L")];

const outlineOf = (n: MMNode): OutlineItem => ({ text: topicText(n), children: ordered(n).map(outlineOf) });

/**
 * The branches of the given topics as a Markdown bullet list, in map order, collapsed subtopics included.
 * A branch inside another one given is part of that one. Summaries and boundaries are left out.
 */
export function outlineMarkdown(view: ExcalidrawView, nodeIds: string[]): string | null {
  const els = view.excalidrawAPI?.getSceneElements() ?? [];
  const ids = new Set(nodeIds);
  const roots = new Set(nodeIds.map((id) => nodeData(els.find((e) => e.id === id))?.root).filter((r): r is string => !!r));
  const items: OutlineItem[] = [];
  for (const r of roots) {
    const map = buildMap(els, r);
    const walk = (n: MMNode) => {
      if (ids.has(n.id)) return void items.push(outlineOf(n));
      ordered(n).forEach(walk);
      n.summaries.forEach((s) => walk(s.node));
    };
    if (map) walk(map.root);
  }
  return items.length ? toMarkdown(items) : null;
}

/** Adds the outline items, with everything under them, as subtopics of the node; returns the new subtopics. */
function addOutline(tx: SceneTx, ea: ExcalidrawAutomate, map: MindMap, node: MMNode, items: OutlineItem[]): string[] {
  const fontFamily = node.text?.fontFamily ?? tx.api.getAppState().currentItemFontFamily;
  const at = { x: node.el.x + node.el.width + 40, y: node.el.y };
  // Like addChild: main topics alternate sides and take the next branch color, others the color of their branch.
  let right = node.children.filter((c) => (c.data.side ?? "R") === "R").length;
  let count = node.children.length;
  const inherited = node.parent ? branchOf(node.covers ? map.nodes.get(node.covers[0])! : node) : null;
  const add = (parent: string, depth: number, branch: Branch, it: OutlineItem, order: number, side?: Side): string => {
    const data = { root: map.root.id, parent, order, ...(side ? { side } : {}) };
    const id = createNode(tx, ea, { depth, branch, text: it.text, data, at, fontFamily, roughness: node.el.roughness });
    it.children.forEach((c, i) => add(id, depth + 1, branch, c, i));
    return id;
  };
  const first = node.children.length ? Math.max(...node.children.map((c) => c.data.order)) + 1 : 0;
  return items.map((it, i) => {
    if (inherited) return add(node.id, node.depth + 1, inherited, it, first + i);
    const side: Side = right <= count - right ? "R" : "L";
    if (side === "R") right++;
    return add(node.id, 1, branchColor(count++), it, first + i, side);
  });
}

/** Adds the Markdown outline as subtopics of the node, like XMind's paste; false when there is nothing to add. */
export async function pasteOutline(view: ExcalidrawView, nodeId: string, md: string): Promise<boolean> {
  const items = parseOutline(md);
  if (!items.length) return false;
  const first = run(view, (tx, ea) => {
    const found = mapOf(tx, nodeId);
    if (!found) return null;
    setFolded(tx, found.node, false);
    const ids = addOutline(tx, ea, found.map, found.node, items);
    layoutMap(tx, ea, found.map.root.id);
    return ids[0];
  });
  if (first) await focusNode(view, first, false);
  return true;
}

/**
 * Inserts a new map built from the Markdown outline: a single top item becomes the central topic,
 * several become main topics of a new central topic.
 */
export async function newMapFromOutline(view: ExcalidrawView, md: string): Promise<boolean> {
  const items = parseOutline(md);
  if (!items.length) return false;
  const single = items.length === 1;
  const id = run(view, (tx, ea) => createMap(tx, ea, single ? items[0].text : undefined, single ? items[0].children : items));
  if (id) await focusNode(view, id, false);
  return true;
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

/**
 * The map laid out once more and read back, so what the user dragged since the last layout (sides, boundaries)
 * is taken in before manual moves are dropped.
 */
function settledMap(tx: SceneTx, ea: ExcalidrawAutomate, rootId: string): MindMap | null {
  return layoutMap(tx, ea, rootId) && buildMap(tx.live(), rootId);
}

/** Drops manual adjustments for the node's subtree, or for every map in the drawing. */
export function resetLayout(view: ExcalidrawView, nodeId?: string) {
  run(view, (tx, ea) => {
    const r = nodeId ? rootIdOf(tx.get(nodeId)) : null;
    if (nodeId && !r) return;
    for (const root of r ? [r] : rootsIn(tx.live())) {
      const map = settledMap(tx, ea, root);
      const node = map && (nodeId ? map.nodes.get(nodeId) : map.root);
      if (!node) continue;
      dropOffsets(tx, subtree(node));
      layoutMap(tx, ea, root);
    }
  });
}

/**
 * Gives the node's map another structure and resets its layout. The main topics keep the order they are
 * shown in: clockwise from the top right in a balanced map, otherwise the right side top to bottom, then the left.
 */
export function setStructure(view: ExcalidrawView, nodeId: string, structure: Structure) {
  run(view, (tx, ea) => {
    const r = rootIdOf(tx.get(nodeId));
    const settled = r ? settledMap(tx, ea, r) : null;
    if (!r || !settled) return;
    dropOffsets(tx, [...settled.nodes.values()]);
    const map = buildMap(tx.live(), r)!;
    const right = map.root.children.filter((c) => c.side === "R");
    const left = map.root.children.filter((c) => c.side === "L");
    renumber(tx, structure === "balanced" ? [...right, ...left.reverse()] : [...right, ...left]);
    tx.patch(r, { customData: { ...map.root.el.customData, [KEY]: { ...map.root.data, structure } } });
    layoutMap(tx, ea, r);
  });
}

/** The central topic of the drawing's only map; null when it has none or several. */
export function onlyMap(view: ExcalidrawView): string | null {
  const roots = rootsIn(view.excalidrawAPI?.getSceneElements() ?? []);
  return roots.length === 1 ? roots[0] : null;
}

/** The structure and auto-align of the node's map. */
export function layoutOf(view: ExcalidrawView, nodeId: string | null): { structure: Structure; autoAlign: boolean } | null {
  const els = view.excalidrawAPI?.getSceneElements() ?? [];
  const root = nodeData(els.find((e) => e.id === nodeId))?.root;
  const d = root ? nodeData(els.find((e) => e.id === root)) : null;
  return d ? { structure: structureIn(d), autoAlign: autoAligned(d) } : null;
}

/** Turns auto-align of the node's map on, dropping every manual move, or off, keeping the positions as they are. */
export function toggleAutoAlign(view: ExcalidrawView, nodeId: string) {
  run(view, (tx, ea) => {
    const r = rootIdOf(tx.get(nodeId));
    const map = r ? settledMap(tx, ea, r) : null;
    if (!r || !map) return;
    const autoAlign = !autoAligned(map.root.data);
    if (autoAlign) dropOffsets(tx, [...map.nodes.values()]);
    const el = tx.get(r)!;
    tx.patch(r, { customData: { ...el.customData, [KEY]: { ...nodeData(el)!, autoAlign } } });
    layoutMap(tx, ea, r);
  });
}

function dropOffsets(tx: SceneTx, nodes: MMNode[]) {
  for (const n of nodes) {
    const { ox, oy, lx, ly, ...rest } = n.data;
    if ([ox, oy, lx, ly].some((v) => v !== undefined)) tx.patch(n.id, { customData: { ...n.el.customData, [KEY]: rest } });
  }
}

/** Patches only the properties that differ, so unchanged elements stay untouched. */
function patchChanged(tx: SceneTx, el: El | null | undefined, p: Partial<El>) {
  if (!el) return;
  const changed = Object.entries(p).filter(([k, v]) => JSON.stringify(el[k as keyof El]) !== JSON.stringify(v));
  if (changed.length) tx.patch(el.id, Object.fromEntries(changed));
}

function applyNodeStyle(tx: SceneTx, n: MMNode, st: NodeStyle) {
  patchChanged(tx, n.el, {
    strokeColor: st.borderColor, backgroundColor: st.backgroundColor, fillStyle: "solid", strokeWidth: st.strokeWidth, strokeStyle: "solid",
  });
  patchChanged(tx, n.text, { strokeColor: st.textColor, fontSize: st.fontSize });
}

/**
 * Restyles the whole map from the current settings, as if every topic had just been created:
 * colors, font sizes and lines of topics, summaries, connectors, braces and boundaries,
 * main topics taking the branch colors in turn. Manual moves are dropped too. Texts, fonts
 * and collapsed topics stay. Applies to the map of the given node, or every map in the drawing.
 */
export function resetAll(view: ExcalidrawView, nodeId?: string) {
  run(view, (tx, ea) => {
    const r = nodeId ? rootIdOf(tx.get(nodeId)) : null;
    for (const root of r ? [r] : rootsIn(tx.live())) {
      const map = settledMap(tx, ea, root);
      if (!map) continue;
      restyleMap(tx, map);
      dropOffsets(tx, [...map.nodes.values()]);
      layoutMap(tx, ea, root);
    }
  });
}

function restyleMap(tx: SceneTx, map: MindMap) {
  const branches = new Map<string, Branch>(); // topic id -> its branch
  // In their order: as they were added, or clockwise in a balanced map.
  [...map.root.children].sort(byOrder).forEach((c, i) => branches.set(c.id, branchColor(i)));
  const visit = (n: MMNode, branch: Branch) => {
    applyNodeStyle(tx, n, n.depth === 0 ? styleFor(0, branch) : n.covers ? summaryStyle() : styleFor(n.depth, branch));
    for (const c of n.children) visit(c, branches.get(c.id) ?? branch);
    // A summary's subtopics take the branch of the topics it spans.
    for (const s of n.summaries) visit(s.node, branches.get(s.covers[0]) ?? branch);
  };
  visit(map.root, branchColor(0));

  for (const n of map.nodes.values()) {
    const edge = map.edges.get(n.id);
    const color = tx.get(n.id)!.strokeColor;
    patchChanged(tx, edge, {
      strokeColor: color, strokeWidth: n.depth === 1 ? 2 : 1.5, strokeStyle: "solid", startArrowhead: null, endArrowhead: connectorArrowhead(),
    });
    patchChanged(tx, map.braces.get(n.id), { strokeColor: color, strokeWidth: 2, strokeStyle: "solid" });
  }
  for (const el of tx.live()) {
    const d = relationData(el);
    if (!d || !inMap(map, d)) continue;
    const color = relationshipColors();
    patchChanged(tx, el, { strokeColor: color.line, strokeWidth: 1.5, strokeStyle: "dashed", startArrowhead: null, endArrowhead: "arrow" });
    if (d.bend !== RELATION_BEND) tx.patch(el.id, { customData: { ...el.customData, [KEY]: { ...d, bend: RELATION_BEND } } });
    const tid = boundTextId(el);
    patchChanged(tx, tid ? tx.get(tid) : null, { strokeColor: color.text });
  }
  const c = boundaryColors();
  for (const b of map.boundaries.values()) {
    patchChanged(tx, b.el, { strokeColor: c.line, backgroundColor: c.fill, fillStyle: "solid", strokeWidth: 2, strokeStyle: "dashed" });
    patchChanged(tx, b.title, { strokeColor: c.titleFill, backgroundColor: c.titleFill, fillStyle: "solid", strokeWidth: 1, strokeStyle: "solid" });
    patchChanged(tx, b.titleText, { strokeColor: c.title, fontSize: TITLE_FONT_SIZE });
  }
}
