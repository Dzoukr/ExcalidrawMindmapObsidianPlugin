import { Menu, setIcon } from "obsidian";
import { Direction } from "./actions";

export interface PanelActions {
  newMap(): void;
  addChild(): void;
  addSibling(): void;
  addSummary(): void;
  addBoundary(): void;
  edit(): void;
  remove(): void;
  nav(dir: Direction): void;
  toggleFold(): void;
  copy(): void;
  paste(): void;
  promote(): void;
  demote(): void;
  relayout(): void;
  reset(): void;
  togglePause(): void;
}

export interface PanelState {
  node: boolean; // a mind map node is selected or being edited
  root: boolean; // that node is the central topic
  summary: boolean; // that node is a summary topic
  topics: boolean; // one or more topics are selected, to copy
  siblings: boolean; // the selection is one or more sibling topics that can get a summary or a boundary
  boundary: boolean; // a boundary (frame or title) is selected instead of a node
  foldable: boolean; // that node can be collapsed or expanded
  collapsed: boolean; // that node is collapsed
  promote: boolean; // that node can be promoted to its parent's level
  demote: boolean; // that node can be demoted under the sibling above
  canDeleteRoot: boolean; // deleting the central topic (and so the whole map) is allowed
  paused: boolean; // the plugin leaves keys and edits to Excalidraw
}

type Key = "newMap" | "child" | "sibling" | "summary" | "boundary" | "edit" | "remove" | "copy" | "paste" | "left" | "up" | "down" | "right" | "promote" | "demote" | "fold" | "layout" | "pause";

/** Floating control bar docked at the bottom of an Excalidraw view. */
export class FloatingPanel {
  readonly el: HTMLElement;
  private readonly buttons = new Map<Key, HTMLButtonElement>();

  constructor(a: PanelActions) {
    this.el = createDiv({ cls: "mm-panel" });
    const group = () => this.el.createDiv({ cls: "mm-group" });
    const button = (g: HTMLElement, key: Key, icon: string, label: string, fn: (b: HTMLButtonElement) => void) => {
      const b = g.createEl("button", { cls: "mm-btn clickable-icon", attr: { "aria-label": label } });
      setIcon(b, icon);
      // Keep focus on the canvas (or on the text editor) so keyboard control keeps working.
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", (e) => {
        e.preventDefault();
        fn(b);
      });
      this.buttons.set(key, b);
    };

    const g1 = group();
    button(g1, "newMap", "network", "New mind map", a.newMap);
    const g2 = group();
    button(g2, "child", "corner-down-right", "Add child (Tab / Insert)", a.addChild);
    button(g2, "sibling", "plus", "Add sibling (Enter)", a.addSibling);
    button(g2, "summary", "braces", "Add summary of the selected topics", a.addSummary);
    button(g2, "boundary", "square-dashed", "Add boundary around the selected topics", a.addBoundary);
    button(g2, "edit", "pencil", "Edit text (F2 / Space)", a.edit);
    button(g2, "remove", "trash-2", "Delete with subtopics (Delete)", a.remove);
    const gc = group();
    button(gc, "copy", "copy", "Copy as Markdown (Ctrl+C)", a.copy);
    button(gc, "paste", "clipboard-paste", "Paste Markdown as subtopics (Ctrl+V), or as a new map with nothing selected", a.paste);
    const g3 = group();
    button(g3, "left", "arrow-left", "Select left", () => a.nav("left"));
    button(g3, "up", "arrow-up", "Select up", () => a.nav("up"));
    button(g3, "down", "arrow-down", "Select down", () => a.nav("down"));
    button(g3, "right", "arrow-right", "Select right", () => a.nav("right"));
    const gl = group();
    button(gl, "promote", "indent-decrease", "Promote to the parent's level (Alt+arrow toward the central topic)", a.promote);
    button(gl, "demote", "indent-increase", "Demote under the topic above (Alt+arrow away from the central topic)", a.demote);
    const g4 = group();
    button(g4, "fold", "chevrons-down-up", "Collapse (Ctrl+/)", a.toggleFold);
    button(g4, "layout", "refresh-cw", "Reset layout", (b) => {
      const menu = new Menu();
      menu.addItem((i) => i.setTitle("Reset sizes only").setIcon("refresh-cw").onClick(a.relayout));
      menu.addItem((i) => i.setTitle("Reset full layout").setIcon("rotate-ccw").onClick(a.reset));
      const r = b.getBoundingClientRect();
      menu.showAtPosition({ x: r.left, y: r.top }, b.doc);
    });
    const g5 = group();
    button(g5, "pause", "pause", "", a.togglePause);
  }

  mount(parent: HTMLElement) {
    // The view content becomes the positioning box, so the panel offsets are measured from the canvas area.
    parent.addClass("mm-host");
    if (this.el.parentElement !== parent) parent.appendChild(this.el);
  }

  setVisible(visible: boolean) {
    this.el.toggleClass("mm-hidden", !visible);
  }

  update(s: PanelState) {
    const pause = this.buttons.get("pause")!;
    if (pause.hasClass("is-active") !== s.paused) {
      setIcon(pause, s.paused ? "play" : "pause");
      pause.toggleClass("is-active", s.paused);
    }
    pause.setAttr("aria-label", s.paused ? "Resume mind map editing" : "Pause mind map editing (use Excalidraw's own shortcuts)");
    this.el.toggleClass("mm-paused", s.paused);
    if (s.paused) {
      for (const [k, b] of this.buttons) b.disabled = k !== "pause";
      return;
    }
    const set = (k: Key, enabled: boolean) => (this.buttons.get(k)!.disabled = !enabled);
    set("newMap", true);
    set("layout", true);
    for (const k of ["child", "edit", "left", "up", "down", "right"] as Key[]) set(k, s.node);
    set("sibling", s.node && !s.root && !s.summary);
    set("summary", s.siblings);
    set("boundary", s.siblings);
    set("edit", s.node || s.boundary);
    set("remove", (s.node && (!s.root || s.canDeleteRoot)) || s.boundary);
    set("fold", s.foldable);
    set("copy", s.topics);
    set("paste", true);
    set("promote", s.promote);
    set("demote", s.demote);
    const fold = this.buttons.get("fold")!;
    if (fold.dataset.collapsed !== String(s.collapsed)) {
      fold.dataset.collapsed = String(s.collapsed);
      setIcon(fold, s.collapsed ? "chevrons-up-down" : "chevrons-down-up");
      fold.setAttr("aria-label", s.collapsed ? "Expand (Ctrl+/)" : "Collapse (Ctrl+/)");
    }
    set("up", s.node && !s.root);
    set("down", s.node && !s.root);
  }

  destroy() {
    this.el.parentElement?.removeClass("mm-host");
    this.el.remove();
  }
}
