import { Menu, setIcon } from "obsidian";
import { Direction } from "./actions";
import { STRUCTURES, Structure } from "./model";

export interface PanelActions {
  newMap: () => void;
  addChild: () => void;
  addSibling: () => void;
  addSummary: () => void;
  addBoundary: () => void;
  addRelationship: () => void;
  edit: () => void;
  remove: () => void;
  nav: (dir: Direction) => void;
  toggleFold: () => void;
  copy: () => void;
  paste: () => void;
  duplicate: () => void;
  promote: () => void;
  demote: () => void;
  reset: () => void;
  resetAll: () => void;
  setStructure: (s: Structure) => void;
  toggleAutoAlign: () => void;
  togglePause: () => void;
}

export interface PanelState {
  node: boolean; // a mind map node is selected or being edited
  root: boolean; // that node is the central topic
  summary: boolean; // that node is a summary topic
  topics: boolean; // one or more topics are selected, to copy
  pair: boolean; // exactly two topics or boundaries are selected, to connect with a relationship
  siblings: boolean; // the selection is one or more sibling topics that can get a summary or a boundary
  boundary: boolean; // a boundary (frame or title) is selected instead of a node
  foldable: boolean; // that node can be collapsed or expanded
  collapsed: boolean; // that node is collapsed
  promote: boolean; // that node can be promoted to its parent's level
  demote: boolean; // that node can be demoted under the sibling above
  layout: { structure: Structure; autoAlign: boolean } | null; // of the selected topic's map, or of the only map in the drawing
  canDeleteRoot: boolean; // deleting the central topic (and so the whole map) is allowed, or it is the map's only topic
  paused: boolean; // the plugin leaves keys and edits to Excalidraw
}

type Key = "newMap" | "child" | "sibling" | "summary" | "boundary" | "relation" | "edit" | "remove" | "copy" | "paste" | "duplicate" | "left" | "up" | "down" | "right" | "promote" | "demote" | "fold" | "layout" | "pause";

/** Floating control bar docked at the bottom of an Excalidraw view. */
export class FloatingPanel {
  readonly el: HTMLElement;
  private readonly buttons = new Map<Key, HTMLButtonElement>();
  private layout: PanelState["layout"] = null;

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
    button(g2, "relation", "spline", "Add relationship from the first to the second selected topic or boundary", a.addRelationship);
    button(g2, "edit", "pencil", "Edit text (F2 / Space)", a.edit);
    button(g2, "remove", "trash-2", "Delete with subtopics (Delete)", a.remove);
    const gc = group();
    button(gc, "copy", "copy", "Copy as Markdown (Ctrl+C)", a.copy);
    button(gc, "paste", "clipboard-paste", "Paste Markdown as subtopics (Ctrl+V), or as a new map with nothing selected", a.paste);
    button(gc, "duplicate", "copy-plus", "Duplicate with subtopics (Ctrl+D)", a.duplicate);
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
    button(g4, "layout", "sliders-horizontal", "Layout settings", (b) => {
      const menu = new Menu();
      const l = this.layout;
      menu.addItem((i) => i.setTitle(l ? "Structure" : "Structure (select a topic of the map)").setIsLabel(true));
      for (const [s, name] of Object.entries(STRUCTURES) as [Structure, string][])
        menu.addItem((i) => i.setTitle(name).setChecked(l?.structure === s).setDisabled(!l).onClick(() => a.setStructure(s)));
      menu.addSeparator();
      menu.addItem((i) => i.setTitle("Auto-align").setChecked(!!l?.autoAlign).setDisabled(!l).onClick(a.toggleAutoAlign));
      menu.addSeparator();
      menu.addItem((i) =>
        i.setTitle("Reset layout").setIcon("rotate-ccw").setDisabled(!!l?.autoAlign).onClick(a.reset),
      );
      menu.addItem((i) => i.setTitle("Reset all").setIcon("eraser").onClick(a.resetAll));
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
    this.layout = s.layout;
    const set = (k: Key, enabled: boolean) => (this.buttons.get(k)!.disabled = !enabled);
    set("newMap", true);
    set("layout", true);
    for (const k of ["child", "edit", "left", "up", "down", "right"] as Key[]) set(k, s.node);
    set("sibling", s.node && !s.root && !s.summary);
    set("summary", s.siblings);
    set("boundary", s.siblings);
    set("relation", s.pair);
    set("edit", s.node || s.boundary);
    set("remove", (s.node && (!s.root || s.canDeleteRoot)) || s.boundary);
    set("fold", s.foldable);
    set("copy", s.topics);
    set("paste", true);
    set("duplicate", (s.topics || s.node) && !s.summary);
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
