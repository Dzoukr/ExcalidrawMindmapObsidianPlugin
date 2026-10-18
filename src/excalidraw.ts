import { ItemView, TFile, View } from "obsidian";

// Minimal typings for the parts of the Excalidraw plugin this plugin touches.

export type El = {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isDeleted?: boolean;
  version?: number;
  customData?: Record<string, any>;
  boundElements?: { id: string; type: string }[] | null;
  containerId?: string | null;
  [key: string]: any;
};

export type CaptureUpdate = "IMMEDIATELY" | "NEVER" | "EVENTUALLY";

export interface ExcalidrawAPI {
  getSceneElements(): readonly El[];
  getSceneElementsIncludingDeleted(): readonly El[];
  getAppState(): any;
  updateScene(scene: { elements?: readonly El[]; appState?: any; captureUpdate?: CaptureUpdate }): void;
  onChange?(cb: (elements: readonly El[], appState: any, files: any) => void): () => void;
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
export function getEA(view: ExcalidrawView): any | null {
  const global = (window as any).ExcalidrawAutomate;
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

  patch(id: string, p: Partial<El>) {
    const e = this.cur.get(id);
    if (!e) return;
    this.cur.set(id, { ...e, ...p });
    this.dirty.add(id);
  }

  add(el: El) {
    this.cur.set(el.id, el);
    this.added.push(el.id);
  }

  /** Position in the z-order, -1 for elements added in this transaction. */
  indexOf(id: string): number {
    return this.order.indexOf(id);
  }

  /** Adds elements at the given z-order position instead of on top. */
  insert(els: El[], index: number) {
    for (const el of els) this.cur.set(el.id, el);
    this.order.splice(index, 0, ...els.map((e) => e.id));
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
