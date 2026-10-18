import { Menu, setIcon } from "obsidian";
import { Direction } from "./actions";

export interface PanelActions {
  newMap(): void;
  addChild(): void;
  addSibling(): void;
  addSummary(): void;
  edit(): void;
  remove(): void;
  nav(dir: Direction): void;
  relayout(): void;
  reset(): void;
}

export interface PanelState {
  node: boolean; // a mind map node is selected or being edited
  root: boolean; // that node is the central topic
  summary: boolean; // that node is a summary topic
  canSummarize: boolean; // the selection is one or more sibling topics that can get a summary
  canDeleteRoot: boolean; // deleting the central topic (and so the whole map) is allowed
}

type Key = "newMap" | "child" | "sibling" | "summary" | "edit" | "remove" | "left" | "up" | "down" | "right" | "layout";

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
    button(g2, "edit", "pencil", "Edit text (F2 / Space)", a.edit);
    button(g2, "remove", "trash-2", "Delete with subtopics (Delete)", a.remove);
    const g3 = group();
    button(g3, "left", "arrow-left", "Select left", () => a.nav("left"));
    button(g3, "up", "arrow-up", "Select up", () => a.nav("up"));
    button(g3, "down", "arrow-down", "Select down", () => a.nav("down"));
    button(g3, "right", "arrow-right", "Select right", () => a.nav("right"));
    const g4 = group();
    button(g4, "layout", "refresh-cw", "Reset layout", (b) => {
      const menu = new Menu();
      menu.addItem((i) => i.setTitle("Reset sizes only").setIcon("refresh-cw").onClick(a.relayout));
      menu.addItem((i) => i.setTitle("Reset full layout").setIcon("rotate-ccw").onClick(a.reset));
      const r = b.getBoundingClientRect();
      menu.showAtPosition({ x: r.left, y: r.top }, b.doc);
    });
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
    const set = (k: Key, enabled: boolean) => (this.buttons.get(k)!.disabled = !enabled);
    for (const k of ["child", "edit", "left", "up", "down", "right"] as Key[]) set(k, s.node);
    set("sibling", s.node && !s.root && !s.summary);
    set("summary", s.canSummarize);
    set("remove", s.node && (!s.root || s.canDeleteRoot));
    set("up", s.node && !s.root);
    set("down", s.node && !s.root);
  }

  destroy() {
    this.el.parentElement?.removeClass("mm-host");
    this.el.remove();
  }
}
