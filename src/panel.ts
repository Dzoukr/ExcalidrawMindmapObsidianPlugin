import { Menu, setIcon } from "obsidian";
import { STRUCTURES, Structure } from "./model";
import { Theme, colorsOf, themeName, themeOptions } from "./styles";

export interface PanelActions {
  newMap: () => void;
  addChild: () => void;
  addSibling: () => void;
  addSummary: () => void;
  addBoundary: () => void;
  addRelationship: () => void;
  addCallout: () => void;
  toggleHighlight: () => void;
  edit: () => void;
  remove: () => void;
  toggleFold: () => void;
  copy: () => void;
  paste: () => void;
  duplicate: () => void;
  promote: () => void;
  demote: () => void;
  reset: () => void;
  resetAll: () => void;
  setStructure: (s: Structure) => void;
  setTheme: (t: Theme) => void;
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
  callout: boolean; // a callout is selected instead of a node
  calloutable: boolean; // the selected node can get a callout, or has one to edit
  highlightable: boolean; // a selected topic, other than a central one, can be highlighted
  highlighted: boolean; // all the selected topics that can be highlighted are
  foldable: boolean; // that node can be collapsed or expanded
  collapsed: boolean; // that node is collapsed
  promote: boolean; // that node can be promoted to its parent's level
  demote: boolean; // that node can be demoted under the sibling above
  layout: { structure: Structure; autoAlign: boolean; theme: Theme } | null; // of the selected topic's map, or of the only map in the drawing
  canDeleteRoot: boolean; // deleting the central topic (and so the whole map) is allowed, or it is the map's only topic
  paused: boolean; // the plugin leaves keys and edits to Excalidraw
}

/** Where the panel is docked: a row at the bottom or top of the canvas, or a column on its left or right side. */
export type PanelPosition = "bottom" | "top" | "left" | "right";

export const PANEL_POSITIONS: Record<PanelPosition, string> = { bottom: "Bottom", top: "Top", left: "Left side", right: "Right side" };

export const isPanelPosition = (p: unknown): p is PanelPosition => typeof p === "string" && Object.prototype.hasOwnProperty.call(PANEL_POSITIONS, p);

/** How the panel looks: like Obsidian's own toolbars, in the accent color, standing out from the theme, see-through, or with colored icons. */
export type PanelStyle = "default" | "accent" | "contrast" | "translucent" | "colorful";

export const PANEL_STYLES: Record<PanelStyle, string> = {
  default: "Default",
  accent: "Accent color",
  contrast: "High contrast",
  translucent: "Translucent",
  colorful: "Colorful icons",
};

export const isPanelStyle = (p: unknown): p is PanelStyle => typeof p === "string" && Object.prototype.hasOwnProperty.call(PANEL_STYLES, p);

/** A theme's name after a few of its colors: the central topic and the first branches. */
export function themeTitle(t: Theme): DocumentFragment {
  const c = colorsOf(t);
  return createFragment((f) => {
    const swatches = f.createSpan({ cls: "mm-swatches" });
    for (const color of [c.central.fill, ...c.branches.slice(0, 4).map((b) => b.stroke)])
      swatches.createSpan({ cls: "mm-swatch" }).setCssProps({ "--mm-swatch": color });
    f.appendText(themeName(t) ?? "Missing theme");
  });
}

type Key =
  | "newMap" | "child" | "sibling" | "summary" | "boundary" | "relation" | "callout" | "highlight" | "edit" | "remove"
  | "copy" | "paste" | "duplicate" | "promote" | "demote" | "fold" | "layout" | "theme" | "pause" | "more";

/**
 * Floating control bar docked on an Excalidraw view. On desktop every action has its button; on phones and tablets
 * the bar keeps the ones that build the map and the rest are in its ⋯ menu, so it fits a narrow screen.
 */
export class FloatingPanel {
  readonly el: HTMLElement;
  private readonly buttons = new Map<Key, HTMLButtonElement>();
  private state: PanelState | null = null;
  private position: PanelPosition = "bottom";
  private style: PanelStyle = "default";

  constructor(private readonly a: PanelActions, compact: boolean) {
    this.el = createDiv({ cls: "mm-panel mm-pos-bottom mm-style-default" });
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
    if (!compact) button(g2, "callout", "message-square", "Add callout, a note above the topic", a.addCallout);
    if (!compact) button(g2, "highlight", "highlighter", "Highlight", a.toggleHighlight);
    button(g2, "edit", "pencil", "Edit text (F2 / Space)", a.edit);
    button(g2, "remove", "trash-2", "Delete with subtopics (Delete)", a.remove);
    if (compact) {
      button(group(), "more", "more-horizontal", "More", (b) => this.showMenu(this.moreMenu(), b));
      return;
    }
    const gc = group();
    button(gc, "copy", "copy", "Copy as Markdown (Ctrl+C)", a.copy);
    button(gc, "paste", "clipboard-paste", "Paste Markdown as subtopics (Ctrl+V), or as a new map with nothing selected", a.paste);
    button(gc, "duplicate", "copy-plus", "Duplicate with subtopics (Ctrl+D)", a.duplicate);
    const gl = group();
    button(gl, "promote", "indent-decrease", "Promote to the parent's level (Alt+arrow toward the central topic)", a.promote);
    button(gl, "demote", "indent-increase", "Demote under the topic above (Alt+arrow away from the central topic)", a.demote);
    const g4 = group();
    button(g4, "fold", "chevrons-down-up", "Collapse (Ctrl+/)", a.toggleFold);
    button(g4, "layout", "sliders-horizontal", "Layout settings", (b) => {
      const menu = new Menu();
      this.layoutItems(menu);
      this.showMenu(menu, b);
    });
    button(g4, "theme", "palette", "Theme", (b) => {
      const menu = new Menu();
      this.themeItems(menu);
      this.showMenu(menu, b);
    });
    button(group(), "pause", "pause", "", a.togglePause);
  }

  /** The themes, the presets and then the user's own, the one of the selected topic's map checked. */
  private themeItems(menu: Menu) {
    const l = this.state?.layout ?? null;
    menu.addItem((i) => i.setTitle(l ? "Theme" : "Theme (select a topic of the map)").setIsLabel(true));
    const themes = themeOptions();
    for (const t of themes) {
      if (t.user && !themes[themes.indexOf(t) - 1].user) menu.addSeparator();
      menu.addItem((i) => i.setTitle(themeTitle(t.id)).setChecked(l?.theme === t.id).setDisabled(!l).onClick(() => this.a.setTheme(t.id)));
    }
  }


  /** Structure, auto-align and the resets of the selected topic's map. */
  private layoutItems(menu: Menu) {
    const a = this.a;
    const l = this.state?.layout ?? null;
    menu.addItem((i) => i.setTitle(l ? "Structure" : "Structure (select a topic of the map)").setIsLabel(true));
    for (const [s, name] of Object.entries(STRUCTURES) as [Structure, string][])
      menu.addItem((i) => i.setTitle(name).setChecked(l?.structure === s).setDisabled(!l).onClick(() => a.setStructure(s)));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle("Auto-align").setChecked(!!l?.autoAlign).setDisabled(!l).onClick(a.toggleAutoAlign));
    menu.addSeparator();
    menu.addItem((i) => i.setTitle("Reset layout").setIcon("rotate-ccw").setDisabled(!!l?.autoAlign).onClick(a.reset));
    menu.addItem((i) => i.setTitle("Reset all").setIcon("eraser").onClick(a.resetAll));
  }

  /** The ⋯ menu of the compact bar: clipboard, levels, collapse, layout and pause. Paused, only Resume. */
  private moreMenu(): Menu {
    const a = this.a;
    const menu = new Menu();
    const s = this.state;
    const item = (title: string, icon: string, enabled: boolean, fn: () => void) =>
      menu.addItem((i) => i.setTitle(title).setIcon(icon).setDisabled(!enabled).onClick(fn));
    if (s?.paused) {
      item("Resume mind map editing", "play", true, a.togglePause);
      return menu;
    }
    item("Copy as Markdown", "copy", !!s?.topics, a.copy);
    item(s?.node ? "Paste Markdown as subtopics" : "Paste Markdown as a new map", "clipboard-paste", true, a.paste);
    item("Duplicate with subtopics", "copy-plus", !!s && (s.topics || s.node) && !s.summary, a.duplicate);
    item("Add callout", "message-square", !!s?.calloutable, a.addCallout);
    item(s?.highlighted ? "Remove highlight" : "Highlight", "highlighter", !!s?.highlightable, a.toggleHighlight);
    menu.addSeparator();
    item("Promote to the parent's level", "indent-decrease", !!s?.promote, a.promote);
    item("Demote under the topic above", "indent-increase", !!s?.demote, a.demote);
    item(s?.collapsed ? "Expand" : "Collapse", s?.collapsed ? "chevrons-up-down" : "chevrons-down-up", !!s?.foldable, a.toggleFold);
    menu.addSeparator();
    this.layoutItems(menu);
    menu.addSeparator();
    this.themeItems(menu);
    menu.addSeparator();
    item("Pause mind map editing (use Excalidraw's own shortcuts)", "pause", true, a.togglePause);
    return menu;
  }

  mount(parent: HTMLElement) {
    // The view content becomes the positioning box, so the panel offsets are measured from the canvas area.
    parent.addClass("mm-host");
    if (this.el.parentElement !== parent) parent.appendChild(this.el);
  }

  setPosition(p: PanelPosition) {
    if (p === this.position && this.el.hasClass(`mm-pos-${p}`)) return;
    this.el.removeClass(`mm-pos-${this.position}`);
    this.el.addClass(`mm-pos-${p}`);
    this.position = p;
  }

  setStyle(s: PanelStyle) {
    if (s === this.style) return;
    this.el.removeClass(`mm-style-${this.style}`);
    this.el.addClass(`mm-style-${s}`);
    this.style = s;
  }

  /** Opens the menu from the button, toward the canvas rather than off the edge the panel is docked on. */
  private showMenu(menu: Menu, b: HTMLElement) {
    const r = b.getBoundingClientRect();
    if (this.position === "top") menu.showAtPosition({ x: r.left, y: r.bottom }, b.doc);
    else if (this.position === "bottom") menu.showAtPosition({ x: r.left, y: r.top }, b.doc);
    else menu.showAtPosition({ x: r.left, y: r.top, width: r.width, left: this.position === "right" }, b.doc);
  }

  setVisible(visible: boolean) {
    this.el.toggleClass("mm-hidden", !visible);
  }

  update(s: PanelState) {
    this.state = s;
    // Paused, only the button that resumes works: the pause button, or the ⋯ menu holding Resume.
    // It stays lit so it is obvious how to resume.
    const pause = this.buttons.get("pause");
    const resume = pause ?? this.buttons.get("more")!;
    if (pause && pause.hasClass("is-active") !== s.paused) setIcon(pause, s.paused ? "play" : "pause");
    resume.toggleClass("is-active", s.paused);
    if (pause) pause.setAttr("aria-label", s.paused ? "Resume mind map editing" : "Pause mind map editing (use Excalidraw's own shortcuts)");
    else resume.setAttr("aria-label", s.paused ? "Resume mind map editing" : "More");
    this.el.toggleClass("mm-paused", s.paused);
    if (s.paused) {
      for (const b of this.buttons.values()) b.disabled = b !== resume;
      return;
    }
    const set = (k: Key, enabled: boolean) => {
      const b = this.buttons.get(k);
      if (b) b.disabled = !enabled;
    };
    for (const k of ["newMap", "paste", "layout", "theme", "pause", "more"] as Key[]) set(k, true);
    set("child", s.node);
    set("sibling", s.node && !s.root && !s.summary);
    set("summary", s.siblings);
    set("boundary", s.siblings);
    set("relation", s.pair);
    set("callout", s.calloutable);
    set("highlight", s.highlightable);
    this.buttons.get("highlight")?.setAttr("aria-label", s.highlighted ? "Remove highlight" : "Highlight");
    set("edit", s.node || s.boundary || s.callout);
    set("remove", (s.node && (!s.root || s.canDeleteRoot)) || s.boundary || s.callout);

    set("copy", s.topics);
    set("duplicate", (s.topics || s.node) && !s.summary);
    set("promote", s.promote);
    set("demote", s.demote);
    set("fold", s.foldable);
    const fold = this.buttons.get("fold");
    if (fold && fold.dataset.collapsed !== String(s.collapsed)) {
      fold.dataset.collapsed = String(s.collapsed);
      setIcon(fold, s.collapsed ? "chevrons-up-down" : "chevrons-down-up");
      fold.setAttr("aria-label", s.collapsed ? "Expand (Ctrl+/)" : "Collapse (Ctrl+/)");
    }
  }

  destroy() {
    this.el.parentElement?.removeClass("mm-host");
    this.el.remove();
  }
}
