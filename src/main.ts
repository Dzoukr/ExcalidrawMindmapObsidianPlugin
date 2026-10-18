import { App, ItemView, Notice, Platform, Plugin, PluginSettingTab, Scope, Setting, SettingDefinition, SettingDefinitionItem } from "obsidian";
import {
  Direction, addBoundary, addChild, addRelationship, followRelations, addSibling, addSummary, areSiblingTopics, changeLevel, commitEditing, deleteBoundary,
  deleteNode, deleteNodes, demote, editBoundaryTitle, editNode, editingNode, editingTitle, moveNode, navigate, newMap,
  newMapFromOutline, outlineMarkdown, pasteOutline, promote, relayout, resetAll, resetLayout, selectedBadge, selectedBoundary,
  selectedNode, selectedNodes, selectedTopics, toggleFold, topicState, unfold,
} from "./actions";
import { AppState, El, ExcalidrawAPI, ExcalidrawView, VIEW_TYPE_EXCALIDRAW, isExcalidrawView } from "./excalidraw";
import { nodeData, titleData } from "./model";
import { isOutline } from "./outline";
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
    // Before it had a text color, the relationship color was a single string for both.
    relationship: typeof c.relationship === "string"
      ? { line: c.relationship, text: c.relationship }
      : { ...DEFAULT_COLORS.relationship, ...c.relationship },
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
  badge: string | null; // topic whose fold badge was clicked, so the click unfolds it once
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
    this.settings = mergeSettings((await this.loadData()) as Partial<Settings> | null);
    setColors(this.settings.colors);
    setArrows(this.settings.arrows);
    this.addSettingTab(new MindMapSettingTab(this.app, this));

    this.keyScope = new Scope(this.app.scope);
    this.keyScope.register([], "F2", () => {
      const view = this.activeView();
      if (view) void this.edit(view);
      return false;
    });

    // Excalidraw copies and pastes through the clipboard events, so taking them first turns them into Markdown for topics.
    const listen = (win: Window) => {
      this.registerDomEvent(win, "keydown", this.onKeyDown, { capture: true });
      for (const type of ["copy", "cut", "paste"] as const) this.registerDomEvent(win, type, this.onClipboard, { capture: true });
    };
    listen(window);
    this.registerEvent(this.app.workspace.on("window-open", (_w, win) => listen(win)));
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
      id: "copy-outline",
      name: "Copy selected topics as Markdown",
      checkCallback: (checking) => this.withActiveView(checking, (v) => this.copyCommand(v)),
    });
    this.addCommand({
      id: "paste-outline",
      name: "Paste Markdown outline as subtopics of the selected topic",
      checkCallback: (checking) => this.withActiveView(checking, (v) => this.pasteCommand(v, false)),
    });
    this.addCommand({
      id: "new-mind-map-from-outline",
      name: "Insert new mind map from Markdown outline in the clipboard",
      checkCallback: (checking) => this.withActiveView(checking, (v) => this.pasteCommand(v, true)),
    });
    this.addCommand({
      id: "add-summary",
      name: "Add summary to selected topics",
      checkCallback: (checking) => this.withActiveView(checking, (v) => this.summarize(v)),
    });
    this.addCommand({
      id: "add-relationship",
      name: "Add relationship between the two selected topics",
      checkCallback: (checking) => this.withActiveView(checking, (v) => this.relate(v)),
    });
    this.addCommand({
      id: "add-boundary",
      name: "Add boundary around selected topics",
      checkCallback: (checking) => this.withActiveView(checking, (v) => this.bound(v)),
    });
    this.addCommand({
      id: "toggle-fold",
      name: "Collapse or expand selected topic",
      checkCallback: (checking) => this.withActiveView(checking, (v) => this.runOnNode(v, (id) => toggleFold(v, id))),
    });
    this.addCommand({
      id: "promote",
      name: "Promote selected topic to its parent's level",
      checkCallback: (checking) => this.withActiveView(checking, (v) => this.runOnNode(v, (id) => promote(v, id))),
    });
    this.addCommand({
      id: "demote",
      name: "Demote selected topic under the topic above",
      checkCallback: (checking) => this.withActiveView(checking, (v) => this.runOnNode(v, (id) => demote(v, id))),
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
    this.addCommand({
      id: "reset-all",
      name: "Reset all: layout, colors and styles of the mind map from the settings",
      checkCallback: (checking) => this.withActiveView(checking, (v) => resetAll(v, selectedNode(v)?.id)),
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

    const s: ViewState = {
      view, api, panel: new FloatingPanel(this.panelActions(view)), editing: null, pending: null, raf: 0, badge: null,
    };
    s.panel.mount(view.contentEl);
    s.unsubscribe = api.onChange?.((_els, appState) => this.onSceneChange(s, appState));
    this.states.set(view, s);
    this.refreshPanel(s);
  }

  private detach(s: ViewState) {
    s.unsubscribe?.();
    if (s.raf) window.cancelAnimationFrame(s.raf);
    s.panel.destroy();
  }

  private onSceneChange(s: ViewState, appState: AppState) {
    const editing: El | null = appState.editingTextElement ?? null;
    if (s.editing && !editing) {
      const containerId = s.editing.containerId;
      s.editing = null;
      if (containerId) window.setTimeout(() => this.afterEdit(s, containerId), 0);
    } else if (editing) {
      s.editing = editing;
    }
    if (!s.raf) {
      s.raf = window.requestAnimationFrame(() => {
        s.raf = 0;
        this.checkBadge(s);
        if (!this.paused && !s.api.getAppState().editingTextElement) followRelations(s.view);
        this.refreshPanel(s);
      });
    }
  }

  /** Clicking a fold badge selects it: expand its topic, like XMind's expand button. */
  private checkBadge(s: ViewState) {
    const node = this.paused || s.api.getAppState().viewModeEnabled ? null : selectedBadge(s.view);
    if (node && node !== s.badge) void unfold(s.view, node);
    s.badge = node;
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
    const t = node ? topicState(s.view, node.id) : { foldable: false, collapsed: false, promote: false, demote: false };
    s.panel.update({
      node: !!node,
      root: !!node && nodeData(node)?.parent === null,
      summary: !!node && !!nodeData(node)?.summary,
      topics: !editing && selectedTopics(s.view).length > 0,
      pair: !editing && selected.length === 2,
      siblings: areSiblingTopics(selected),
      boundary: !editing && !!selectedBoundary(s.view),
      ...t,
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
    void addSummary(view, selectedNodes(view).map((n) => n.id));
  }

  /** Puts a boundary around the selected topics, or the topic being edited. */
  private bound(view: ExcalidrawView) {
    if (editingNode(view)) return this.runOnNode(view, (id) => addBoundary(view, [id]));
    void addBoundary(view, selectedNodes(view).map((n) => n.id));
  }

  /** Connects the two selected topics with a relationship, from the first selected to the second. */
  private relate(view: ExcalidrawView) {
    const nodes = selectedNodes(view);
    if (nodes.length !== 2) return void new Notice("Select two topics to connect.");
    void addRelationship(view, nodes[0].id, nodes[1].id);
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

  // ---------- markdown outlines ----------

  private async copyCommand(view: ExcalidrawView) {
    const md = outlineMarkdown(view, selectedTopics(view).map((n) => n.id));
    if (!md) return void new Notice("Select one or more topics to copy.");
    try {
      await navigator.clipboard.writeText(md);
    } catch {
      return void new Notice("Can't write to the clipboard.");
    }
    new Notice("Topics copied as Markdown.");
  }

  /** Pastes the clipboard's outline under the selected topic, or as a new map. */
  private async pasteCommand(view: ExcalidrawView, asNewMap: boolean) {
    const node = selectedNode(view);
    if (!asNewMap && !node) return void new Notice("Select the topic to paste under.");
    await this.pasteFromClipboard(view, asNewMap ? null : node!.id);
  }

  /** Panel paste: under the selected topic (or the one being edited), as a new map when no topic is selected. */
  private paste(view: ExcalidrawView) {
    if (editingNode(view)) return this.runOnNode(view, (id) => this.pasteFromClipboard(view, id));
    void this.pasteFromClipboard(view, selectedNode(view)?.id ?? null);
  }

  private async pasteFromClipboard(view: ExcalidrawView, nodeId: string | null) {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return void new Notice("Can't read the clipboard.");
    }
    if (!isOutline(text)) return void new Notice("The clipboard has no text to paste as topics.");
    if (nodeId) await pasteOutline(view, nodeId, text);
    else await newMapFromOutline(view, text);
  }

  /**
   * Ctrl+C / Ctrl+X on selected topics copies their branches as a Markdown bullet list (cut deletes them),
   * Ctrl+V on a selected topic adds the pasted outline or text as its subtopics. Anything else is left to Excalidraw.
   */
  private onClipboard = (e: ClipboardEvent) => {
    if (this.paused || !e.isTrusted || !e.clipboardData) return;
    const view = this.activeView();
    if (!view) return;
    const target = e.target as HTMLElement;
    if (!view.containerEl.contains(target) && target !== target.ownerDocument?.body) return;
    if (target.isContentEditable || target.instanceOf(HTMLInputElement) || target.instanceOf(HTMLTextAreaElement)) return;
    const appState = view.excalidrawAPI!.getAppState();
    if (appState.viewModeEnabled || appState.editingTextElement) return;

    if (e.type === "paste") {
      const node = selectedNode(view);
      const text = e.clipboardData.getData("text/plain");
      if (!node || e.clipboardData.files.length || !isOutline(text)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      void pasteOutline(view, node.id, text);
      return;
    }
    const ids = selectedTopics(view).map((n) => n.id);
    const md = outlineMarkdown(view, ids);
    if (!md) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    e.clipboardData.setData("text/plain", md);
    if (e.type === "cut") void deleteNodes(view, ids, this.settings.allowDeleteCentralTopic);
    else new Notice("Topics copied as Markdown.");
  };

  private panelActions(view: ExcalidrawView): PanelActions {
    const on = (action: (id: string) => unknown) => () => this.runOnNode(view, action);
    return {
      newMap: () => void newMap(view),
      addChild: on((id) => addChild(view, id)),
      addSibling: on((id) => addSibling(view, id, false)),
      addSummary: () => this.summarize(view),
      addBoundary: () => this.bound(view),
      addRelationship: () => this.relate(view),
      edit: () => void this.edit(view),
      remove: () => void this.remove(view),
      nav: (dir) => this.runOnNode(view, (id) => navigate(view, id, dir)),
      toggleFold: () => this.runOnNode(view, (id) => toggleFold(view, id)),
      copy: () => void this.copyCommand(view),
      paste: () => void this.paste(view),
      promote: () => this.runOnNode(view, (id) => promote(view, id)),
      demote: () => this.runOnNode(view, (id) => demote(view, id)),
      relayout: () => relayout(view, selectedNode(view)?.id),
      reset: () => resetLayout(view, selectedNode(view)?.id),
      resetAll: () => resetAll(view, selectedNode(view)?.id),
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
    // XMind's Alt+Up/Down reorders the topic among its siblings, Alt+Left/Right promotes or demotes it.
    const alt = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey;
    const reorder = alt && (e.key === "ArrowUp" || e.key === "ArrowDown");
    const level = alt && (e.key === "ArrowLeft" || e.key === "ArrowRight");
    // XMind's Ctrl+/ (Cmd+/ on Mac) collapses or expands the topic; the physical key also counts on other keyboard layouts.
    const fold = (e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "/" || e.code === "Slash");
    if (!plain && !reorder && !level && !fold) return;

    let action: ((id: string) => unknown) | null = null;

    if (fold) {
      if (appState.editingTextElement || !selectedNode(view)) return;
      if (target.isContentEditable || target.instanceOf(HTMLInputElement) || target.instanceOf(HTMLTextAreaElement)) return;
      action = (id) => toggleFold(view, id);
    } else if (reorder) {
      if (appState.editingTextElement || !selectedNode(view)) return;
      if (target.isContentEditable || target.instanceOf(HTMLInputElement) || target.instanceOf(HTMLTextAreaElement)) return;
      action = (id) => moveNode(view, id, e.key === "ArrowUp");
    } else if (level) {
      if (appState.editingTextElement || !selectedNode(view)) return;
      if (target.isContentEditable || target.instanceOf(HTMLInputElement) || target.instanceOf(HTMLTextAreaElement)) return;
      action = (id) => changeLevel(view, id, e.key === "ArrowRight" ? "right" : "left");
    } else if (appState.editingTextElement) {
      // Excalidraw's [[link]] suggester is open: its Enter and Tab pick a link.
      if (e.defaultPrevented || target.ownerDocument.body.querySelector(":scope > .suggestion-container")) return;
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
      if (target.isContentEditable || target.instanceOf(HTMLInputElement) || target.instanceOf(HTMLTextAreaElement)) return;
      const boundary = selectedBoundary(view);
      if (boundary) {
        // A selected boundary: Delete removes it, Space or Enter edits its title.
        if (e.key === "Delete" || e.key === "Backspace") void deleteBoundary(view, boundary);
        else if ((e.key === " " || e.key === "Enter") && !e.repeat) void editBoundaryTitle(view, boundary);
        else return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }
      if (!selectedNode(view)) {
        // Several topics selected, maybe with their connectors: Delete removes them all.
        const topics = e.key === "Delete" || e.key === "Backspace" ? selectedTopics(view) : [];
        if (!topics.length) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        void deleteNodes(view, topics.map((n) => n.id), this.settings.allowDeleteCentralTopic);
        return;
      }
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

  // Control keys are paths into the settings, such as "colors.central.text".
  getControlValue(key: string): unknown {
    return key.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], this.plugin.settings);
  }

  async setControlValue(key: string, value: unknown) {
    const path = key.split(".");
    const last = path.pop()!;
    const target = path.reduce((o, k) => o[k] as Record<string, unknown>, this.plugin.settings as unknown as Record<string, unknown>);
    target[last] = value;
    await this.plugin.saveSettings();
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const color = (name: string, key: string): SettingDefinition => ({ name, control: { type: "color", key } });
    return [
      {
        name: "Show control panel on desktop",
        desc: "The floating panel is always shown on mobile.",
        control: { type: "toggle", key: "showPanelOnDesktop" },
      },
      {
        name: "Allow deleting the central topic",
        desc: "Deleting the central topic removes the whole mind map: every topic and connector.",
        control: { type: "toggle", key: "allowDeleteCentralTopic" },
      },
      {
        name: "Arrows instead of lines",
        desc: "Connectors point to the subtopic with an arrowhead. Used for connectors created from now on, and when you reset all.",
        control: { type: "toggle", key: "arrows" },
      },
      {
        type: "page",
        name: "Colors",
        desc: "Used for topics created from now on. Existing topics keep their colors until you reset all from the panel's layout menu.",
        items: [
          {
            type: "group",
            heading: "Central topic",
            items: [color("Text", "colors.central.text"), color("Border", "colors.central.border"), color("Background", "colors.central.fill")],
          },
          {
            type: "group",
            heading: "Topics",
            items: [{ ...color("Text", "colors.topicText"), desc: "Text of main topics and subtopics." }],
          },
          {
            type: "group",
            heading: "Summary",
            items: [color("Text", "colors.summary.text"), color("Border and brace", "colors.summary.border"), color("Background", "colors.summary.fill")],
          },
          {
            type: "group",
            heading: "Boundary",
            items: [
              color("Line", "colors.boundary.line"),
              color("Background", "colors.boundary.fill"),
              color("Title text", "colors.boundary.title"),
              color("Title background", "colors.boundary.titleFill"),
            ],
          },
          {
            type: "group",
            heading: "Relationship",
            items: [color("Line and arrowhead", "colors.relationship.line"), color("Label text", "colors.relationship.text")],
          },
          this.branchList(),
          {
            name: "Reset colors to defaults",
            desc: "Restores the default colors, branch colors included.",
            action: () => {
              this.plugin.settings.colors = structuredClone(DEFAULT_COLORS);
              void this.saveAndUpdate();
            },
          },
        ],
      },
    ];
  }

  /** Branch colors that main topics take in turn: line and border, then main topic background. */
  private branchList(): SettingDefinitionItem {
    const branches = this.plugin.settings.colors.branches;
    return {
      type: "list",
      heading: "Branches",
      items: branches.map((b, i) => ({
        name: `Branch ${i + 1}`,
        desc: i === 0 ? "Main topics take these in turn. Line and border, then main topic background." : undefined,
        render: (s: Setting) => {
          const picker = (label: string, get: () => string, set: (v: string) => void) =>
            s.addColorPicker((p) => {
              p.setValue(get()).onChange(async (v) => {
                set(v);
                await this.plugin.saveSettings();
              });
              s.controlEl.lastElementChild?.setAttr("aria-label", label);
            });
          picker("Line and border", () => b.stroke, (v) => (b.stroke = v));
          picker("Background", () => b.fill, (v) => (b.fill = v));
        },
      })),
      onDelete: (i) => {
        if (branches.length <= 1) return void new Notice("At least one branch color is needed.");
        branches.splice(i, 1);
        void this.saveAndUpdate();
      },
      onReorder: (from, to) => {
        branches.splice(to, 0, ...branches.splice(from, 1));
        void this.saveAndUpdate();
      },
      addItem: {
        name: "Add branch color",
        action: () => {
          branches.push({ ...DEFAULT_COLORS.branches[branches.length % DEFAULT_COLORS.branches.length] });
          void this.saveAndUpdate();
        },
      },
    };
  }

  private async saveAndUpdate() {
    await this.plugin.saveSettings();
    this.update();
  }
}
