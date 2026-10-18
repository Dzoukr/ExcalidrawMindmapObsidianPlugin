import { App, ItemView, Platform, Plugin, PluginSettingTab, Scope, Setting } from "obsidian";
import {
  Direction, addBoundary, addChild, addSibling, addSummary, areSiblingTopics, commitEditing, deleteBoundary, deleteNode,
  editBoundaryTitle, editNode, editingNode, editingTitle, moveNode, navigate, newMap, relayout, resetLayout, selectedBoundary,
  selectedNode, selectedNodes,
} from "./actions";
import { El, ExcalidrawAPI, ExcalidrawView, VIEW_TYPE_EXCALIDRAW, isExcalidrawView } from "./excalidraw";
import { nodeData, titleData } from "./model";
import { FloatingPanel, PanelActions } from "./panel";
import { Colors, DEFAULT_COLORS, setArrows, setColors } from "./styles";

interface Settings {
  showPanelOnDesktop: boolean;
  allowDeleteCentralTopic: boolean;
  arrows: boolean; // connectors end in an arrowhead instead of a plain line
  colors: Colors;
}

const DEFAULT_SETTINGS: Settings = { showPanelOnDesktop: true, allowDeleteCentralTopic: false, arrows: false, colors: DEFAULT_COLORS };

/** Saved settings over the defaults; colors are merged per field so new color options get their default. */
function mergeSettings(saved: Partial<Settings> | null): Settings {
  const c: Partial<Colors> = saved?.colors ?? {};
  const colors: Colors = structuredClone({
    central: { ...DEFAULT_COLORS.central, ...c.central },
    topicText: c.topicText ?? DEFAULT_COLORS.topicText,
    summary: { ...DEFAULT_COLORS.summary, ...c.summary },
    boundary: { ...DEFAULT_COLORS.boundary, ...c.boundary },
    branches: c.branches?.length ? c.branches : DEFAULT_COLORS.branches,
  });
  return { ...DEFAULT_SETTINGS, ...saved, colors };
}

interface ViewState {
  view: ExcalidrawView;
  api: ExcalidrawAPI;
  unsubscribe?: () => void;
  panel: FloatingPanel;
  editing: El | null; // text element being edited, to detect when editing ends
  pending: ((nodeId: string) => unknown) | null; // action to run once editing ends
  raf: number;
}

const ARROWS: Record<string, Direction> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };
const ATTACH_RETRIES = 50;

export default class ExcalidrawMindMapPlugin extends Plugin {
  settings: Settings = DEFAULT_SETTINGS;
  private states = new Map<ExcalidrawView, ViewState>();
  private retries = new WeakMap<ExcalidrawView, number>();
  private retryTimer = 0;
  // Obsidian handles its own hotkeys (F2 = rename file) before any DOM listener,
  // so keys that clash with Obsidian are claimed through a keymap scope while a drawing is active.
  private keyScope!: Scope;
  private scopePushed = false;
  // While paused, keys and text edits are left to Excalidraw. Not saved: a restart resumes.
  private paused = false;

  async onload() {
    this.settings = mergeSettings(await this.loadData());
    setColors(this.settings.colors);
    setArrows(this.settings.arrows);
    this.addSettingTab(new MindMapSettingTab(this.app, this));

    this.keyScope = new Scope(this.app.scope);
    this.keyScope.register([], "F2", () => {
      const view = this.activeView();
      if (view) this.edit(view);
      return false;
    });

    this.registerDomEvent(window, "keydown", this.onKeyDown, { capture: true });
    this.registerEvent(
      this.app.workspace.on("window-open", (_w, win) => this.registerDomEvent(win, "keydown", this.onKeyDown, { capture: true })),
    );
    this.registerEvent(this.app.workspace.on("layout-change", () => this.syncViews()));
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        this.syncViews();
        this.syncKeyScope();
      }),
    );
    this.registerEvent(this.app.workspace.on("file-open", () => this.syncViews()));
    this.app.workspace.onLayoutReady(() => {
      this.syncViews();
      this.syncKeyScope();
    });

    this.addCommand({
      id: "toggle-pause",
      name: "Pause or resume mind map editing",
      callback: () => this.togglePause(),
    });
    this.addCommand({
      id: "new-mind-map",
      name: "Insert new mind map",
      checkCallback: (checking) => this.withActiveView(checking, (v) => newMap(v)),
    });
    this.addCommand({
      id: "add-summary",
      name: "Add summary to selected topics",
      checkCallback: (checking) => this.withActiveView(checking, (v) => this.summarize(v)),
    });
    this.addCommand({
      id: "add-boundary",
      name: "Add boundary around selected topics",
      checkCallback: (checking) => this.withActiveView(checking, (v) => this.bound(v)),
    });
    this.addCommand({
      id: "relayout",
      name: "Refresh mind map layout (keep moved topics)",
      checkCallback: (checking) => this.withActiveView(checking, (v) => relayout(v, selectedNode(v)?.id)),
    });
    this.addCommand({
      id: "reset-layout",
      name: "Reset mind map layout (discard moved topics)",
      checkCallback: (checking) => this.withActiveView(checking, (v) => resetLayout(v, selectedNode(v)?.id)),
    });
  }

  onunload() {
    window.clearTimeout(this.retryTimer);
    if (this.scopePushed) this.app.keymap.popScope(this.keyScope);
    for (const s of this.states.values()) this.detach(s);
    this.states.clear();
  }

  async saveSettings() {
    setColors(this.settings.colors);
    setArrows(this.settings.arrows);
    await this.saveData(this.settings);
    for (const s of this.states.values()) this.refreshPanel(s);
  }

  private activeView(): ExcalidrawView | null {
    const v = this.app.workspace.getActiveViewOfType(ItemView);
    return isExcalidrawView(v) && v.excalidrawAPI ? v : null;
  }

  private withActiveView(checking: boolean, fn: (v: ExcalidrawView) => unknown): boolean {
    const v = this.activeView();
    if (!v) return false;
    if (!checking) fn(v);
    return true;
  }

  // ---------- view tracking ----------

  /** The scope is active only while a node is selected in the active drawing, so F2 renames the file otherwise. */
  private syncKeyScope() {
    const view = this.activeView();
    const active =
      !this.paused && !!view && !view.excalidrawAPI!.getAppState().editingTextElement &&
      (!!selectedNode(view) || !!selectedBoundary(view));
    if (active && !this.scopePushed) this.app.keymap.pushScope(this.keyScope);
    if (!active && this.scopePushed) this.app.keymap.popScope(this.keyScope);
    this.scopePushed = active;
  }

  private togglePause() {
    this.paused = !this.paused;
    this.syncKeyScope();
    for (const s of this.states.values()) this.refreshPanel(s);
  }

  private syncViews() {
    const views = this.app.workspace
      .getLeavesOfType(VIEW_TYPE_EXCALIDRAW)
      .map((l) => l.view)
      .filter(isExcalidrawView);
    for (const [v, s] of this.states) {
      if (!views.includes(v)) {
        this.detach(s);
        this.states.delete(v);
      }
    }
    for (const v of views) this.attach(v);
  }

  private attach(view: ExcalidrawView) {
    const api = view.excalidrawAPI;
    if (!api) {
      // The Excalidraw component mounts asynchronously after the view opens.
      const n = this.retries.get(view) ?? 0;
      if (n < ATTACH_RETRIES) {
        this.retries.set(view, n + 1);
        window.clearTimeout(this.retryTimer);
        this.retryTimer = window.setTimeout(() => this.syncViews(), 200);
      }
      return;
    }
    this.retries.delete(view);
    const existing = this.states.get(view);
    if (existing?.api === api) {
      existing.panel.mount(view.contentEl);
      this.refreshPanel(existing);
      return;
    }
    if (existing) this.detach(existing);

    const s: ViewState = { view, api, panel: new FloatingPanel(this.panelActions(view)), editing: null, pending: null, raf: 0 };
    s.panel.mount(view.contentEl);
    s.unsubscribe = api.onChange?.((_els, appState) => this.onSceneChange(s, appState));
    this.states.set(view, s);
    this.refreshPanel(s);
  }

  private detach(s: ViewState) {
    s.unsubscribe?.();
    if (s.raf) cancelAnimationFrame(s.raf);
    s.panel.destroy();
  }

  private onSceneChange(s: ViewState, appState: any) {
    const editing: El | null = appState.editingTextElement ?? null;
    if (s.editing && !editing) {
      const containerId = s.editing.containerId;
      s.editing = null;
      if (containerId) window.setTimeout(() => this.afterEdit(s, containerId), 0);
    } else if (editing) {
      s.editing = editing;
    }
    if (!s.raf) {
      s.raf = requestAnimationFrame(() => {
        s.raf = 0;
        this.refreshPanel(s);
      });
    }
  }

  /** Text editing of a node ended: re-layout to fit the new text, then run a queued action. */
  private afterEdit(s: ViewState, containerId: string) {
    const pending = s.pending;
    s.pending = null;
    if (this.paused) return;
    const el = s.api.getSceneElements().find((e) => e.id === containerId);
    if (!nodeData(el) && !titleData(el)) return;
    relayout(s.view, containerId);
    pending?.(containerId);
  }

  private refreshPanel(s: ViewState) {
    if (s.view === this.activeView()) this.syncKeyScope();
    const visible = (Platform.isMobile || this.settings.showPanelOnDesktop) && !s.api.getAppState().viewModeEnabled;
    s.panel.setVisible(visible);
    if (!visible) return;
    const editing = editingNode(s.view);
    const selected = editing ? [editing] : selectedNodes(s.view);
    const node = selected.length === 1 ? selected[0] : null;
    s.panel.update({
      node: !!node,
      root: !!node && nodeData(node)?.parent === null,
      summary: !!node && !!nodeData(node)?.summary,
      siblings: areSiblingTopics(selected),
      boundary: !editing && !!selectedBoundary(s.view),
      canDeleteRoot: this.settings.allowDeleteCentralTopic,
      paused: this.paused,
    });
  }

  // ---------- commands on the selected node ----------

  /**
   * Runs an action on the selected node. While a node's text is being edited,
   * the edit is committed first and the action runs once Excalidraw has applied the text.
   */
  private runOnNode(view: ExcalidrawView, action: (nodeId: string) => unknown) {
    const editing = editingNode(view);
    if (editing) {
      const s = this.states.get(view);
      if (s) s.pending = action;
      commitEditing(view);
      return;
    }
    const node = selectedNode(view);
    if (node) action(node.id);
  }

  /** Adds a summary spanning the selected topics, or the topic being edited. */
  private summarize(view: ExcalidrawView) {
    if (editingNode(view)) return this.runOnNode(view, (id) => addSummary(view, [id]));
    addSummary(view, selectedNodes(view).map((n) => n.id));
  }

  /** Puts a boundary around the selected topics, or the topic being edited. */
  private bound(view: ExcalidrawView) {
    if (editingNode(view)) return this.runOnNode(view, (id) => addBoundary(view, [id]));
    addBoundary(view, selectedNodes(view).map((n) => n.id));
  }

  /** Edits the selected node's text, or the selected boundary's title. */
  private edit(view: ExcalidrawView) {
    const boundary = selectedBoundary(view);
    if (boundary) return editBoundaryTitle(view, boundary);
    this.runOnNode(view, (id) => editNode(view, id));
  }

  /** Deletes the selected node with its subtopics, or the selected boundary. */
  private remove(view: ExcalidrawView) {
    const boundary = selectedBoundary(view);
    if (boundary) return deleteBoundary(view, boundary);
    this.runOnNode(view, (id) => deleteNode(view, id, this.settings.allowDeleteCentralTopic));
  }

  private panelActions(view: ExcalidrawView): PanelActions {
    const on = (action: (id: string) => unknown) => () => this.runOnNode(view, action);
    return {
      newMap: () => newMap(view),
      addChild: on((id) => addChild(view, id)),
      addSibling: on((id) => addSibling(view, id, false)),
      addSummary: () => this.summarize(view),
      addBoundary: () => this.bound(view),
      edit: () => this.edit(view),
      remove: () => this.remove(view),
      nav: (dir) => this.runOnNode(view, (id) => navigate(view, id, dir)),
      relayout: () => relayout(view, selectedNode(view)?.id),
      reset: () => resetLayout(view, selectedNode(view)?.id),
      togglePause: () => this.togglePause(),
    };
  }

  // ---------- keyboard ----------

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.paused || !e.isTrusted || e.isComposing) return; // our own replayed keys pass through to Excalidraw
    const view = this.activeView();
    if (!view) return;
    const target = e.target as HTMLElement;
    if (!view.containerEl.contains(target) && target !== target.ownerDocument?.body) return;
    const appState = view.excalidrawAPI!.getAppState();
    if (appState.viewModeEnabled) return;
    const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
    // XMind's Alt+Up/Down reorders the topic among its siblings.
    const reorder = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowDown");
    if (!plain && !reorder) return;

    let action: ((id: string) => unknown) | null = null;

    if (reorder) {
      if (appState.editingTextElement || !selectedNode(view)) return;
      if (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      action = (id) => moveNode(view, id, e.key === "ArrowUp");
    } else if (appState.editingTextElement) {
      if (editingTitle(view)) {
        // Enter commits a boundary title.
        if (e.key !== "Enter" || e.shiftKey) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        commitEditing(view);
        return;
      }
      // XMind behaviour inside the text editor: Enter commits, Tab/Insert commits and adds a child.
      if (!editingNode(view)) return;
      if (e.key === "Enter" && !e.shiftKey) action = () => undefined;
      else if ((e.key === "Tab" && !e.shiftKey) || e.key === "Insert") action = (id) => addChild(view, id);
      if (!action) return;
    } else {
      if (target.isContentEditable || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      const boundary = selectedBoundary(view);
      if (boundary) {
        // A selected boundary: Delete removes it, Space or Enter edits its title.
        if (e.key === "Delete" || e.key === "Backspace") deleteBoundary(view, boundary);
        else if ((e.key === " " || e.key === "Enter") && !e.repeat) editBoundaryTitle(view, boundary);
        else return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }
      if (!selectedNode(view)) return;
      switch (e.key) {
        case "Tab":
          if (!e.shiftKey) action = (id) => addChild(view, id);
          break;
        case "Insert":
          action = (id) => addChild(view, id);
          break;
        case "Enter":
          action = (id) => addSibling(view, id, e.shiftKey);
          break;
        case "Delete":
        case "Backspace":
          action = (id) => deleteNode(view, id, this.settings.allowDeleteCentralTopic);
          break;
        case " ":
          if (!e.repeat) action = (id) => editNode(view, id);
          break;
        default:
          if (ARROWS[e.key] && !e.shiftKey) action = (id) => navigate(view, id, ARROWS[e.key]);
      }
      if (!action) return;
    }

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    this.runOnNode(view, action);
  };
}

class MindMapSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ExcalidrawMindMapPlugin) {
    super(app, plugin);
  }

  display() {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName("Show control panel on desktop")
      .setDesc("The floating panel is always shown on mobile.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.showPanelOnDesktop).onChange(async (v) => {
          this.plugin.settings.showPanelOnDesktop = v;
          await this.plugin.saveSettings();
        }),
      );
    new Setting(this.containerEl)
      .setName("Allow deleting the central topic")
      .setDesc("Deleting the central topic removes the whole mind map: every topic and connector.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.allowDeleteCentralTopic).onChange(async (v) => {
          this.plugin.settings.allowDeleteCentralTopic = v;
          await this.plugin.saveSettings();
        }),
      );
    new Setting(this.containerEl)
      .setName("Arrows instead of lines")
      .setDesc("Connectors point to the subtopic with an arrowhead. Used for connectors created from now on.")
      .addToggle((t) =>
        t.setValue(this.plugin.settings.arrows).onChange(async (v) => {
          this.plugin.settings.arrows = v;
          await this.plugin.saveSettings();
        }),
      );
    this.displayColors();
  }

  private displayColors() {
    const el = this.containerEl;
    const colors = this.plugin.settings.colors;
    const save = () => this.plugin.saveSettings();
    const picker = (s: Setting, label: string, get: () => string, set: (v: string) => void) =>
      s.addColorPicker((p) => {
        p.setValue(get()).onChange(async (v) => {
          set(v);
          await save();
        });
        s.controlEl.lastElementChild?.setAttr("aria-label", label);
      });

    new Setting(el)
      .setName("Colors")
      .setDesc("Used for topics created from now on. Existing topics keep their colors.")
      .setHeading();

    const central = new Setting(el).setName("Central topic").setDesc("Text, border and background.");
    picker(central, "Text", () => colors.central.text, (v) => (colors.central.text = v));
    picker(central, "Border", () => colors.central.border, (v) => (colors.central.border = v));
    picker(central, "Background", () => colors.central.fill, (v) => (colors.central.fill = v));

    picker(new Setting(el).setName("Topic text").setDesc("Text of main topics and subtopics."),
      "Text", () => colors.topicText, (v) => (colors.topicText = v));

    const summary = new Setting(el).setName("Summary").setDesc("Text, border and brace, background.");
    picker(summary, "Text", () => colors.summary.text, (v) => (colors.summary.text = v));
    picker(summary, "Border and brace", () => colors.summary.border, (v) => (colors.summary.border = v));
    picker(summary, "Background", () => colors.summary.fill, (v) => (colors.summary.fill = v));

    const boundary = new Setting(el).setName("Boundary").setDesc("Dashed line, background, title text, title background.");
    picker(boundary, "Line", () => colors.boundary.line, (v) => (colors.boundary.line = v));
    picker(boundary, "Background", () => colors.boundary.fill, (v) => (colors.boundary.fill = v));
    picker(boundary, "Title text", () => colors.boundary.title, (v) => (colors.boundary.title = v));
    picker(boundary, "Title background", () => colors.boundary.titleFill, (v) => (colors.boundary.titleFill = v));

    colors.branches.forEach((b, i) => {
      const s = new Setting(el)
        .setName(`Branch ${i + 1}`)
        .setDesc(i === 0 ? "Main topics take these in turn. Line and border, then main topic background." : "");
      picker(s, "Line and border", () => b.stroke, (v) => (b.stroke = v));
      picker(s, "Background", () => b.fill, (v) => (b.fill = v));
      s.addExtraButton((x) =>
        x.setIcon("trash-2").setTooltip("Remove").setDisabled(colors.branches.length <= 1).onClick(async () => {
          colors.branches.splice(i, 1);
          await save();
          this.display();
        }),
      );
    });

    new Setting(el)
      .addButton((x) =>
        x.setButtonText("Add branch color").onClick(async () => {
          colors.branches.push({ ...DEFAULT_COLORS.branches[colors.branches.length % DEFAULT_COLORS.branches.length] });
          await save();
          this.display();
        }),
      )
      .addButton((x) =>
        x.setButtonText("Reset colors to defaults").onClick(async () => {
          this.plugin.settings.colors = structuredClone(DEFAULT_COLORS);
          await save();
          this.display();
        }),
      );
  }
}
