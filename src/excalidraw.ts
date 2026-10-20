import { ItemView, TFile, View } from "obsidian";

// Minimal typings for the parts of the Excalidraw plugin this plugin touches.

export interface Binding {
  elementId: string;
  fixedPoint?: [number, number] | null; // where on the element the arrow is glued, as fractions of its width and height
}

export type El = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  isDeleted?: boolean;
  version?: number;
  versionNonce?: number;
  updated?: number;
  customData?: Record<string, unknown>;
  groupIds?: string[]; // innermost first
  boundElements?: { id: string; type: string }[] | null;
  containerId?: string | null;
  strokeColor: string;
  backgroundColor: string;
  fillStyle?: string;
  strokeWidth?: number;
  strokeStyle?: string;
  roughness: number;
  opacity?: number;
  locked?: boolean;
  link?: string | null;
  hasTextLink?: boolean;
  // lines and arrows
  points?: number[][];
  startBinding?: Binding | null;
  endBinding?: Binding | null;
  startArrowhead?: string | null;
  endArrowhead?: string | null;
  polygon?: boolean; // a closed line, which Excalidraw fills
  // text
  text?: string;
  originalText?: string;
  rawText?: string;
  fontFamily?: number;
  fontSize?: number;
  textAlign?: string;
  verticalAlign?: string;
};

export interface AppState {
  selectedElementIds?: Record<string, boolean>;
  selectedGroupIds?: Record<string, boolean>;
  editingGroupId?: string | null; // the group double-clicked into, whose elements are selected one by one
  editingTextElement?: El | null;
  viewModeEnabled?: boolean;
  zoom?: { value: number };
  scrollX: number;
  scrollY: number;
  width: number;
  height: number;
  currentItemFontFamily: number;
  currentItemRoughness: number;
}

export type CaptureUpdate = "IMMEDIATELY" | "NEVER" | "EVENTUALLY";

export interface ExcalidrawAPI {
  getSceneElements(): readonly El[];
  getSceneElementsIncludingDeleted(): readonly El[];
  getAppState(): AppState;
  updateScene(scene: { elements?: readonly El[]; appState?: Partial<AppState>; captureUpdate?: CaptureUpdate }): void;
  onChange?(cb: (elements: readonly El[], appState: AppState, files: unknown) => void): () => void;
}

/** The parts of the Excalidraw plugin's ExcalidrawAutomate scripting API this plugin uses. */
export interface ExcalidrawAutomate {
  style: Record<string, unknown>;
  clear(): void;
  addText(x: number, y: number, text: string, opts?: Record<string, unknown>): string;
  addArrow(points: number[][], opts?: Record<string, unknown>): string;
  addLine(points: number[][]): string;
  addRect(x: number, y: number, width: number, height: number): string;
  getElement(id: string): El;
  getElements(): El[];
  measureText(text: string): { width: number; height: number };
  selectElementsInView(ids: string[]): void;
  destroy?(): void;
}

export interface ExcalidrawView extends ItemView {
  excalidrawAPI?: ExcalidrawAPI;
  file: TFile | null;
}

export const VIEW_TYPE_EXCALIDRAW = "excalidraw";

export function isExcalidrawView(v: unknown): v is ExcalidrawView {
  return !!v && typeof (v as View).getViewType === "function" && (v as View).getViewType() === VIEW_TYPE_EXCALIDRAW;
}

/** Returns a fresh ExcalidrawAutomate instance targeting the view, or null when Excalidraw is not loaded. */
export function getEA(view: ExcalidrawView): ExcalidrawAutomate | null {
  const global = (window as { ExcalidrawAutomate?: { getAPI?(view: ExcalidrawView): ExcalidrawAutomate } }).ExcalidrawAutomate;
  if (!global?.getAPI) return null;
  return global.getAPI(view);
}

const randomNonce = () => Math.floor(Math.random() * 2 ** 31);

/**
 * Collects element changes and applies them to the scene in one updateScene call,
 * so every mind map operation is a single undo step.
 */
export class SceneTx {
  readonly api: ExcalidrawAPI;
  private readonly cur = new Map<string, El>();
  private readonly order: string[];
  private readonly dirty = new Set<string>();
  private readonly added: string[] = [];
  private changes = 0;

  constructor(readonly view: ExcalidrawView) {
    this.api = view.excalidrawAPI!;
    const els = this.api.getSceneElementsIncludingDeleted();
    this.order = els.map((e) => e.id);
    for (const e of els) this.cur.set(e.id, e);
  }

  get(id: string): El | undefined {
    return this.cur.get(id);
  }

  /** Current state of all non-deleted elements, including pending changes. */
  live(): El[] {
    return [...this.cur.values()].filter((e) => !e.isDeleted);
  }

  /** Counts every change, so a caller can tell whether a step changed anything. */
  get revision(): number {
    return this.changes;
  }

  patch(id: string, p: Partial<El>) {
    const e = this.cur.get(id);
    if (!e) return;
    this.cur.set(id, { ...e, ...p });
    this.dirty.add(id);
    this.changes++;
  }

  add(el: El) {
    this.cur.set(el.id, el);
    this.added.push(el.id);
    this.changes++;
  }

  /** Position in the z-order, -1 for elements added in this transaction. */
  indexOf(id: string): number {
    return this.order.indexOf(id);
  }

  /** Adds elements at the given z-order position instead of on top. */
  insert(els: El[], index: number) {
    for (const el of els) this.cur.set(el.id, el);
    this.order.splice(index, 0, ...els.map((e) => e.id));
    this.changes++;
  }

  delete(id: string) {
    if (this.cur.has(id)) this.patch(id, { isDeleted: true });
  }

  get changed(): boolean {
    return this.dirty.size > 0 || this.added.length > 0;
  }

  commit(captureUpdate: CaptureUpdate = "IMMEDIATELY") {
    if (!this.changed) return;
    const fresh = (e: El): El =>
      this.dirty.has(e.id) ? { ...e, version: (e.version ?? 0) + 1, versionNonce: randomNonce(), updated: Date.now() } : e;
    const elements = this.order.map((id) => fresh(this.cur.get(id)!));
    // Containers before their bound text keeps z-order sane for newly added nodes.
    const added = this.added.map((id) => fresh(this.cur.get(id)!));
    added.sort((a, b) => (a.type === "text" ? 1 : 0) - (b.type === "text" ? 1 : 0));
    this.api.updateScene({ elements: [...elements, ...added], captureUpdate });
  }
}
