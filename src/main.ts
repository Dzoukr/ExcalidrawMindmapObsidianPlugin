import {
  App, FuzzySuggestModal, ItemView, Menu, Modal, Notice, Platform, Plugin, PluginSettingTab, Scope, Setting, SettingDefinition, SettingDefinitionItem, SettingDefinitionPage,
  normalizePath,
} from "obsidian";
import {
  Direction, addBoundary, addCallout, afterDrag, addChild, addRelationship, canAddCallout, followCallouts, followRelations, addSibling, addSummary, areSiblingTopics,
  changeLevel, commitEditing, deleteBoundary, deleteCallout, deleteNode, deleteNodes, demote, dropTargetBox, duplicateNodes, editBoundaryTitle, editCallout, editNode,
  editingCallout, editingNode, editingTitle, isEmptyCallout, isLoneCentral, moveBoundary, moveNode, navigate, newMap, newMapFromOutline, onlyMap, outlineMarkdown, pasteOutline, promote,
  relayout, resetAll, resetLayout, selectedBadge, selectedBoundary, selectedCallout, selectedEnds, selectedNode, selectedNodes, selectedTopics, setStructure, setTheme,
  layoutOf, toggleAutoAlign, toggleFold, topicState, unfold,
} from "./actions";
import { AppState, El, ExcalidrawAPI, ExcalidrawView, VIEW_TYPE_EXCALIDRAW, isExcalidrawView } from "./excalidraw";
import { STRUCTURES, Structure, calloutData, isStructure, nodeData, titleData } from "./model";
import { isOutline } from "./outline";
import { FloatingPanel, PANEL_POSITIONS, PANEL_STYLES, PanelActions, PanelPosition, PanelStyle, isPanelPosition, isPanelStyle, themeTitle } from "./panel";
import {
  CUSTOM_THEME, Colors, DEFAULT_COLORS, Theme, UserTheme, colorsOf, isPreset, mergeColors, newThemeId, parseThemes, setArrows, setMapDefaults, setUserThemes,
  themeOptions, themesToJson, uniqueName,
} from "./styles";

interface Settings {
  showPanelOnDesktop: boolean;
  panelPosition: PanelPosition;
  panelStyle: PanelStyle;
  allowDeleteCentralTopic: boolean;
  arrows: boolean; // connectors end in an arrowhead instead of a plain line
  structure: Structure; // of new maps
  autoAlign: boolean; // of new maps
  theme: Theme; // of new maps
  themes: UserTheme[]; // the user's own, after the presets
}

const DEFAULT_SETTINGS: Settings = {
  showPanelOnDesktop: true, panelPosition: "bottom", panelStyle: "default", allowDeleteCentralTopic: false, arrows: false, structure: "balanced", autoAlign: true,
  theme: CUSTOM_THEME, themes: [{ id: CUSTOM_THEME, name: "Custom", colors: DEFAULT_COLORS }],
};

/**
 * Saved settings over the defaults; theme colors are merged per field so new color options get their default.
 * Before themes, the settings had one set of colors: they become the Custom theme, which maps made then have.
 */
function mergeSettings(saved: (Partial<Settings> & { colors?: unknown }) | null): Settings {
  const { colors: legacy, ...rest } = saved ?? {};
  const merged: Settings = { ...DEFAULT_SETTINGS, ...rest };
  const themes: unknown[] = Array.isArray(saved?.themes) ? saved.themes : [{ id: CUSTOM_THEME, name: "Custom", colors: legacy }];
  merged.themes = [];
  for (const t of themes as Partial<UserTheme>[]) {
    if (!t || typeof t.id !== "string" || !t.id || isPreset(t.id) || merged.themes.some((x) => x.id === t.id)) continue;
    merged.themes.push({ id: t.id, name: typeof t.name === "string" && t.name.trim() ? t.name : "Theme", colors: mergeColors(t.colors) });
  }
  if (!isStructure(merged.structure)) merged.structure = DEFAULT_SETTINGS.structure;
  if (!isPanelPosition(merged.panelPosition)) merged.panelPosition = DEFAULT_SETTINGS.panelPosition;
  if (!isPanelStyle(merged.panelStyle)) merged.panelStyle = DEFAULT_SETTINGS.panelStyle;
  merged.theme = validTheme(merged.theme, merged.themes);
  return merged;
}

/** The theme, or when it is no preset or theme of the user's, Custom if there is one, Classic otherwise. */
function validTheme(theme: unknown, themes: UserTheme[]): Theme {
  if (typeof theme === "string" && (isPreset(theme) || themes.some((t) => t.id === theme))) return theme;
  return themes.some((t) => t.id === CUSTOM_THEME) ? CUSTOM_THEME : "classic";
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
  drop: HTMLElement; // outline of the topic a dragged topic becomes a subtopic of when dropped
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
  private pointerDown = false;

  async onload() {
    this.settings = mergeSettings((await this.loadData()) as Partial<Settings> | null);
    this.applySettings();
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
      this.registerDomEvent(win, "pointerdown", () => (this.pointerDown = true), { capture: true });
      this.registerDomEvent(win, "pointerup", this.onPointerUp, { capture: true });
      this.registerDomEvent(win, "pointercancel", this.onPointerUp, { capture: true });
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
      id: "duplicate",
      name: "Duplicate selected topics with their subtopics",
      checkCallback: (checking) => this.withActiveView(checking, (v) => this.duplicate(v)),
    });
    this.addCommand({
      id: "add-summary",
      name: "Add summary to selected topics",
      checkCallback: (checking) => this.withActiveView(checking, (v) => this.summarize(v)),
    });
    this.addCommand({
      id: "add-relationship",
      name: "Add relationship between the two selected topics or boundaries",
      checkCallback: (checking) => this.withActiveView(checking, (v) => this.relate(v)),
    });
    this.addCommand({
      id: "add-boundary",
      name: "Add boundary around selected topics",
      checkCallback: (checking) => this.withActiveView(checking, (v) => this.bound(v)),
    });
    this.addCommand({
      id: "add-callout",
      name: "Add callout to selected topic",
      checkCallback: (checking) => this.withActiveView(checking, (v) => this.runOnNode(v, (id) => addCallout(v, id))),
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
      id: "change-structure",
      name: "Change structure of the mind map",
      checkCallback: (checking) => this.withActiveView(checking, (v) => this.runOnMap(v, (id) => this.chooseStructure(v, id))),
    });
    this.addCommand({
      id: "change-theme",
      name: "Change theme of the mind map",
      checkCallback: (checking) => this.withActiveView(checking, (v) => this.runOnMap(v, (id) => this.chooseTheme(v, id))),
    });
    this.addCommand({
      id: "toggle-auto-align",
      name: "Turn auto-align of the mind map on or off",
      checkCallback: (checking) => this.withActiveView(checking, (v) => this.runOnMap(v, (id) => toggleAutoAlign(v, id))),
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
      name: "Reset all: layout, colors and styles of the mind map from its theme",
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
    this.applySettings();
    await this.saveData(this.settings);
    for (const s of this.states.values()) this.refreshPanel(s);
  }

  private applySettings() {
    setUserThemes(this.settings.themes);
    setArrows(this.settings.arrows);
    setMapDefaults({ structure: this.settings.structure, autoAlign: this.settings.autoAlign, theme: this.settings.theme });
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
      (!!selectedNode(view) || !!selectedBoundary(view) || !!selectedCallout(view));
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
      view, api, panel: new FloatingPanel(this.panelActions(view), Platform.isMobile), editing: null, pending: null, raf: 0, badge: null,
      drop: createDiv({ cls: "mm-drop-target mm-hidden" }),
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
    s.drop.remove();
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
        if (!this.paused && !s.api.getAppState().editingTextElement) {
          followRelations(s.view);
          followCallouts(s.view);
        }
        this.showDropTarget(s);
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

  /** While topics are dragged, outlines the topic they become subtopics of when dropped now. */
  private showDropTarget(s: ViewState) {
    const box = this.pointerDown && !this.paused ? dropTargetBox(s.view) : null;
    const canvas = s.view.contentEl.querySelector(".excalidraw");
    s.drop.toggleClass("mm-hidden", !box || !canvas);
    if (!box || !canvas) return;
    if (s.drop.parentElement !== s.view.contentEl) s.view.contentEl.appendChild(s.drop);
    const st = s.api.getAppState();
    const z = st.zoom?.value ?? 1;
    const host = s.view.contentEl.getBoundingClientRect();
    const c = canvas.getBoundingClientRect();
    const pad = 4;
    s.drop.setCssStyles({
      left: `${c.left - host.left + (box.x + st.scrollX) * z - pad}px`,
      top: `${c.top - host.top + (box.y + st.scrollY) * z - pad}px`,
      width: `${box.w * z + 2 * pad}px`,
      height: `${box.h * z + 2 * pad}px`,
    });
  }

  /** Text editing of a node ended: re-layout to fit the new text, then run a queued action. */
  private afterEdit(s: ViewState, containerId: string) {
    const pending = s.pending;
    s.pending = null;
    if (this.paused) return;
    const el = s.api.getSceneElements().find((e) => e.id === containerId);
    if (!nodeData(el) && !titleData(el) && !calloutData(el)) return;
    // A callout edited to nothing goes, like an empty text in Excalidraw.
    if (isEmptyCallout(s.view, containerId)) return void deleteCallout(s.view, containerId);
    relayout(s.view, containerId);
    pending?.(containerId);
  }

  private refreshPanel(s: ViewState) {
    if (s.view === this.activeView()) this.syncKeyScope();
    const visible = (Platform.isMobile || this.settings.showPanelOnDesktop) && !s.api.getAppState().viewModeEnabled;
    s.panel.setVisible(visible);
    s.panel.setPosition(this.settings.panelPosition);
    s.panel.setStyle(this.settings.panelStyle);
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
      pair: !editing && selectedEnds(s.view).length === 2,
      siblings: areSiblingTopics(s.view, selected),
      layout: layoutOf(s.view, node?.id ?? onlyMap(s.view)),
      boundary: !editing && !!selectedBoundary(s.view),
      callout: !editing && !!selectedCallout(s.view),
      calloutable: !!node && canAddCallout(s.view, node.id),
      ...t,
      canDeleteRoot: this.settings.allowDeleteCentralTopic || (!!node && isLoneCentral(s.view, node.id)),
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

  /**
   * Runs an action on the map of the selected topic, or on the drawing's only map when no topic is selected;
   * with several maps, a topic has to say which.
   */
  private runOnMap(view: ExcalidrawView, action: (nodeId: string) => unknown) {
    if (editingNode(view) || selectedNode(view)) return this.runOnNode(view, action);
    const root = onlyMap(view);
    if (root) action(root);
    else new Notice("Select a topic of the mind map to change.");
  }

  /** Lets the user pick a structure for the node's map. */
  private chooseStructure(view: ExcalidrawView, nodeId: string) {
    new StructureModal(this.app, layoutOf(view, nodeId)?.structure ?? null, (s) => setStructure(view, nodeId, s)).open();
  }

  /** Lets the user pick a theme for the node's map. */
  private chooseTheme(view: ExcalidrawView, nodeId: string) {
    new ThemeModal(this.app, layoutOf(view, nodeId)?.theme ?? null, (t) => setTheme(view, nodeId, t)).open();
  }

  /** Adds a summary spanning the selected topics, or the topic being edited. */
  private summarize(view: ExcalidrawView) {
    if (editingNode(view)) return this.runOnNode(view, (id) => addSummary(view, [id]));
    void addSummary(view, selectedNodes(view).map((n) => n.id));
  }

  /** Duplicates the selected topics, or the topic being edited. */
  private duplicate(view: ExcalidrawView) {
    if (editingNode(view)) return this.runOnNode(view, (id) => duplicateNodes(view, [id]));
    const ids = selectedTopics(view).map((n) => n.id);
    if (!ids.length) return void new Notice("Select one or more topics to duplicate.");
    void duplicateNodes(view, ids);
  }

  /** Puts a boundary around the selected topics, or the topic being edited. */
  private bound(view: ExcalidrawView) {
    if (editingNode(view)) return this.runOnNode(view, (id) => addBoundary(view, [id]));
    void addBoundary(view, selectedNodes(view).map((n) => n.id));
  }

  /** Connects the two selected topics or boundaries with a relationship, from the first selected to the second. */
  private relate(view: ExcalidrawView) {
    const ends = selectedEnds(view);
    if (ends.length !== 2) return void new Notice("Select two topics or boundaries to connect.");
    void addRelationship(view, ends[0], ends[1]);
  }

  /** Edits the selected node's text, the selected boundary's title or the selected callout's text. */
  private edit(view: ExcalidrawView) {
    const boundary = selectedBoundary(view);
    if (boundary) return editBoundaryTitle(view, boundary);
    const callout = selectedCallout(view);
    if (callout) return editCallout(view, callout);
    this.runOnNode(view, (id) => editNode(view, id));
  }

  /** Deletes the selected node with its subtopics, or the selected boundary or callout. */
  private remove(view: ExcalidrawView) {
    const boundary = selectedBoundary(view);
    if (boundary) return deleteBoundary(view, boundary);
    const callout = selectedCallout(view);
    if (callout) return deleteCallout(view, callout);
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
      addCallout: on((id) => addCallout(view, id)),
      edit: () => void this.edit(view),
      remove: () => void this.remove(view),
      toggleFold: () => this.runOnNode(view, (id) => toggleFold(view, id)),
      copy: () => void this.copyCommand(view),
      paste: () => void this.paste(view),
      duplicate: () => this.duplicate(view),
      promote: () => this.runOnNode(view, (id) => promote(view, id)),
      demote: () => this.runOnNode(view, (id) => demote(view, id)),
      reset: () => resetLayout(view, selectedNode(view)?.id),
      resetAll: () => resetAll(view, selectedNode(view)?.id),
      setStructure: (st) => this.runOnMap(view, (id) => setStructure(view, id, st)),
      setTheme: (t) => this.runOnMap(view, (id) => setTheme(view, id, t)),
      toggleAutoAlign: () => this.runOnMap(view, (id) => toggleAutoAlign(view, id)),
      togglePause: () => this.togglePause(),
    };
  }

  /** Lays out the maps where something was just moved, so subtopics follow and the drop takes effect. */
  private onPointerUp = () => {
    this.pointerDown = false;
    for (const s of this.states.values()) s.drop.addClass("mm-hidden");
    const view = this.activeView();
    if (this.paused || !view) return;
    window.setTimeout(() => {
      const st = view.excalidrawAPI?.getAppState();
      if (st && !st.viewModeEnabled && !st.editingTextElement) afterDrag(view);
    }, 0);
  };

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
    // XMind's Ctrl+D (Cmd+D on Mac) duplicates the topic; Excalidraw's own would copy its shapes, not the topic.
    const dup = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key.toLowerCase() === "d" || e.code === "KeyD");
    if (!plain && !reorder && !level && !fold && !dup) return;

    let action: ((id: string) => unknown) | null = null;

    if (dup) {
      if (appState.editingTextElement) return;
      if (target.isContentEditable || target.instanceOf(HTMLInputElement) || target.instanceOf(HTMLTextAreaElement)) return;
      const ids = selectedTopics(view).map((n) => n.id);
      if (!ids.length) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      void duplicateNodes(view, ids);
      return;
    } else if (fold) {
      if (appState.editingTextElement || !selectedNode(view)) return;
      if (target.isContentEditable || target.instanceOf(HTMLInputElement) || target.instanceOf(HTMLTextAreaElement)) return;
      action = (id) => toggleFold(view, id);
    } else if (reorder) {
      if (appState.editingTextElement) return;
      if (target.isContentEditable || target.instanceOf(HTMLInputElement) || target.instanceOf(HTMLTextAreaElement)) return;
      const boundary = selectedBoundary(view);
      if (boundary) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        void moveBoundary(view, boundary, e.key === "ArrowUp");
        return;
      }
      if (!selectedNode(view)) return;
      action = (id) => moveNode(view, id, e.key === "ArrowUp");
    } else if (level) {
      if (appState.editingTextElement || !selectedNode(view)) return;
      if (target.isContentEditable || target.instanceOf(HTMLInputElement) || target.instanceOf(HTMLTextAreaElement)) return;
      action = (id) => changeLevel(view, id, e.key === "ArrowRight" ? "right" : "left");
    } else if (appState.editingTextElement) {
      // Excalidraw's [[link]] suggester is open: its Enter and Tab pick a link.
      if (e.defaultPrevented || target.ownerDocument.body.querySelector(":scope > .suggestion-container")) return;
      if (editingTitle(view) || editingCallout(view)) {
        // Enter commits a boundary title or a callout; Shift+Enter starts a new line.
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
      const callout = selectedCallout(view);
      if (callout) {
        // A selected callout too: Delete removes it, Space or Enter edits its text.
        if (e.key === "Delete" || e.key === "Backspace") void deleteCallout(view, callout);
        else if ((e.key === " " || e.key === "Enter") && !e.repeat) void editCallout(view, callout);
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

class StructureModal extends FuzzySuggestModal<Structure> {
  constructor(app: App, private current: Structure | null, private choose: (s: Structure) => void) {
    super(app);
    this.setPlaceholder("Structure of the mind map");
  }

  getItems(): Structure[] {
    return Object.keys(STRUCTURES) as Structure[];
  }

  getItemText(s: Structure): string {
    return s === this.current ? `${STRUCTURES[s]} (current)` : STRUCTURES[s];
  }

  onChooseItem(s: Structure) {
    this.choose(s);
  }
}

class ThemeModal extends FuzzySuggestModal<{ id: Theme; name: string }> {
  constructor(app: App, private current: Theme | null, private choose: (t: Theme) => void) {
    super(app);
    this.setPlaceholder("Theme of the mind map");
  }

  getItems(): { id: Theme; name: string }[] {
    return themeOptions();
  }

  getItemText(t: { id: Theme; name: string }): string {
    return t.id === this.current ? `${t.name} (current)` : t.name;
  }

  onChooseItem(t: { id: Theme; name: string }) {
    this.choose(t.id);
  }
}

/** Asks before doing something that can't be undone. */
class ConfirmModal extends Modal {
  constructor(app: App, private heading: string, private text: string, private confirm: string, private onConfirm: () => void) {
    super(app);
  }

  onOpen() {
    this.setTitle(this.heading);
    this.contentEl.createEl("p", { text: this.text });
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText(this.confirm).setDestructive().setCta().onClick(() => {
        this.close();
        this.onConfirm();
      }));
  }

  onClose() {
    this.contentEl.empty();
  }
}

/** Asks for a new name for a theme. */

class RenameModal extends Modal {
  constructor(app: App, private name: string, private rename: (name: string) => void) {
    super(app);
  }

  onOpen() {
    this.setTitle("Rename theme");
    let value = this.name;
    const submit = () => {
      if (!value.trim()) return;
      this.rename(value.trim());
      this.close();
    };
    new Setting(this.contentEl).setName("Name").addText((t) => {
      t.setValue(value).onChange((v) => (value = v));
      t.inputEl.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submit();
      });
      window.setTimeout(() => t.inputEl.select(), 0);
    });
    new Setting(this.contentEl).addButton((b) => b.setButtonText("Rename").setCta().onClick(submit));
  }

  onClose() {
    this.contentEl.empty();
  }
}

class MindMapSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: ExcalidrawMindMapPlugin) {
    super(app, plugin);
  }

  // Control keys are paths into the settings, such as "themes.0.colors.central.text".
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
    return [
      {
        name: "Show control panel on desktop",
        desc: "The floating panel is always shown on mobile.",
        control: { type: "toggle", key: "showPanelOnDesktop" },
      },
      {
        name: "Control panel position",
        desc: "A row at the bottom or top of the drawing, or a column on its left or right side. On phones, where Excalidraw's own toolbars take the bottom, Bottom shows it at the top.",
        control: { type: "dropdown", key: "panelPosition", options: PANEL_POSITIONS },
      },
      {
        name: "Control panel style",
        desc: "How the panel looks: like Obsidian's own toolbars, in the accent color, standing out from the theme, see-through over the drawing, or with colored icons.",
        control: { type: "dropdown", key: "panelStyle", options: PANEL_STYLES },
      },
      {
        name: "Allow deleting the central topic",
        desc: "Deleting the central topic removes the whole mind map: every topic and connector. A central topic with no other topics can be deleted either way.",
        control: { type: "toggle", key: "allowDeleteCentralTopic" },
      },
      {
        name: "Structure of new maps",
        desc: "How main topics are placed around the central topic. Each map keeps its own, changed from the panel's layout settings or the command palette.",
        control: { type: "dropdown", key: "structure", options: STRUCTURES },
      },
      {
        name: "Auto-align new maps",
        desc: "Topics always keep their automatic places: dropping a topic moves it among its siblings instead of leaving it where it is dropped. Each map keeps its own, changed from the panel's layout settings or the command palette.",
        control: { type: "toggle", key: "autoAlign" },
      },
      {
        name: "Theme of new maps",
        desc: "The colors of a map: a built-in theme or one of your own. Each map keeps its own, changed from the panel's theme menu or the command palette.",
        control: { type: "dropdown", key: "theme", options: Object.fromEntries(themeOptions().map((t) => [t.id, t.name])) },
      },
      {
        name: "Arrows instead of lines",
        desc: "Connectors point to the subtopic with an arrowhead. Used for connectors created from now on, and when you reset all.",
        control: { type: "toggle", key: "arrows" },
      },
      {
        type: "page",
        name: "Themes",
        desc: "Your own themes, which the panel's theme menu offers after the built-in ones. Add, edit, import and export them.",
        displayValue: () => String(this.plugin.settings.themes.length),
        items: [this.themeList(), this.themeTransfer()],
      },
    ];
  }

  /** The user's themes, each a page of its colors. */
  private themeList(): SettingDefinitionItem {
    const themes = this.plugin.settings.themes;
    return {
      type: "list",
      heading: "Your themes",
      emptyState: "No themes of your own. Add one, starting from any theme, or import one.",
      items: themes.map((t, i) => this.themePage(t, i)),
      onReorder: (from, to) => {
        themes.splice(to, 0, ...themes.splice(from, 1));
        void this.saveAndUpdate();
      },
      addItem: { name: "Add theme", action: (el) => this.chooseStart(el) },
    };
  }

  /** Lets the user pick the theme a new one starts as a copy of. */
  private chooseStart(el: HTMLElement) {
    const menu = new Menu();
    menu.addItem((i) => i.setTitle("Start from").setIsLabel(true));
    const options = themeOptions();
    for (const t of options) {
      if (t.user && !options[options.indexOf(t) - 1].user) menu.addSeparator();
      menu.addItem((i) => i.setTitle(themeTitle(t.id)).onClick(() => this.addThemes([{ name: `${t.name} copy`, colors: structuredClone(colorsOf(t.id)) }])));
    }
    const r = el.getBoundingClientRect();
    menu.showAtPosition({ x: r.left, y: r.bottom }, el.doc);
  }

  /** Adds themes with new ids, renamed when another theme has their name. */
  private addThemes(added: { name: string; colors: Colors }[]) {
    const themes = this.plugin.settings.themes;
    for (const t of added)
      themes.push({ id: newThemeId(themes.map((x) => x.id)), name: uniqueName(t.name, themes.map((x) => x.name)), colors: t.colors });
    void this.saveAndUpdate();
  }

  /** Deletes the theme after asking, and leaves its page. */
  private deleteTheme(t: UserTheme) {
    new ConfirmModal(this.app, `Delete theme ${t.name}?`, "Maps with this theme keep their colors; topics added to them get the Classic colors.", "Delete", () => {
      const settings = this.plugin.settings;
      settings.themes = settings.themes.filter((x) => x !== t);
      settings.theme = validTheme(settings.theme, settings.themes);
      void this.plugin.saveSettings().then(() => {
        // Obsidian has no public way back from a page; without it, the emptied page stays until the user goes back.
        (this as unknown as { setting?: { closePage?: () => void } }).setting?.closePage?.();
        this.update();
      });
    }).open();
  }

  /** A theme's page: renaming and deleting it, then its colors. */
  private themePage(t: UserTheme, i: number): SettingDefinitionPage {
    const color = (name: string, key: string): SettingDefinition => ({ name, control: { type: "color", key: `themes.${i}.colors.${key}` } });
    const page: SettingDefinitionPage & { id: string } = {
      type: "page",
      id: t.id, // Obsidian finds the open page by its id, the name by default, so renaming the theme keeps the page open
      name: t.name,
      desc: t.id === this.plugin.settings.theme ? "New maps get this theme." : undefined,
      items: [
        {
          type: "group",
          items: [
            {
              name: "Rename",
              desc: `Called ${t.name}.`,
              action: () => new RenameModal(this.app, t.name, (name) => {
                t.name = name;
                void this.saveAndUpdate();
              }).open(),
            },
            { name: "Delete theme", desc: "Maps with this theme keep their colors.", action: () => this.deleteTheme(t) },
          ],
        },
        {
          type: "group",
          heading: "Central topic",
          items: [color("Text", "central.text"), color("Border", "central.border"), color("Background", "central.fill")],
        },
        {
          type: "group",
          heading: "Topics",
          items: [{ ...color("Text", "topicText"), desc: "Text of main topics and subtopics." }],
        },
        {
          type: "group",
          heading: "Summary",
          items: [color("Text", "summary.text"), color("Border and brace", "summary.border"), color("Background", "summary.fill")],
        },
        {
          type: "group",
          heading: "Boundary",
          items: [color("Line", "boundary.line"), color("Background", "boundary.fill"), color("Title text", "boundary.title"), color("Title background", "boundary.titleFill")],
        },
        {
          type: "group",
          heading: "Relationship",
          items: [color("Line and arrowhead", "relationship.line"), color("Label text", "relationship.text")],
        },
        {
          type: "group",
          heading: "Callout",
          items: [color("Text", "callout.text"), color("Background and tail", "callout.fill")],
        },
        this.branchList(t.colors),
        {
          name: "Reset colors to defaults",
          desc: "Restores the default colors, branch colors included.",
          action: () => {
            t.colors = structuredClone(DEFAULT_COLORS);
            void this.saveAndUpdate();
          },
        },
      ],
    };
    return page;
  }

  /** Importing themes from the clipboard or a file, and exporting all of them. */
  private themeTransfer(): SettingDefinitionItem {
    const themes = this.plugin.settings.themes;
    return {
      type: "group",
      heading: "Import and export",
      items: [
        { name: "Import from the clipboard", desc: "Themes copied as JSON from another vault, or shared with you.", action: () => void this.importFromClipboard() },
        { name: "Import from a file", desc: "A JSON file of themes saved from another vault, or shared with you.", action: () => this.importFromFile() },
        { name: "Export to the clipboard", desc: "All your themes as JSON.", disabled: () => !themes.length, action: () => void this.copyThemes(themes) },
        { name: "Export as a file in the vault", desc: "All your themes as a JSON file at the root of the vault.", disabled: () => !themes.length, action: () => void this.saveThemes(themes, "Mind map themes") },
      ],
    };
  }

  private async copyThemes(themes: UserTheme[]) {
    try {
      await navigator.clipboard.writeText(themesToJson(themes));
    } catch {
      return void new Notice("Can't write to the clipboard.");
    }
    new Notice(`${themes.length} ${themes.length === 1 ? "theme" : "themes"} copied to the clipboard.`);
  }

  /** Saves the themes as a JSON file at the root of the vault, numbered when the name is taken. */
  private async saveThemes(themes: UserTheme[], name: string) {
    const vault = this.app.vault;
    const base = name.replace(/[\\/:*?"<>|#^[\]]/g, "-").trim() || "Mind map themes";
    let path = normalizePath(`${base}.json`);
    for (let i = 2; vault.getAbstractFileByPath(path); i++) path = normalizePath(`${base} ${i}.json`);
    try {
      await vault.create(path, themesToJson(themes));
    } catch {
      return void new Notice(`Can't save ${path}.`);
    }
    new Notice(`Saved to ${path}.`);
  }

  private importThemes(text: string) {
    const found = parseThemes(text);
    if (!found) return void new Notice("No themes to import.");
    this.addThemes(found);
    new Notice(found.length === 1 ? `Theme ${found[0].name} imported.` : `${found.length} themes imported.`);
  }

  private async importFromClipboard() {
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return void new Notice("Can't read the clipboard.");
    }
    this.importThemes(text);
  }

  private importFromFile() {
    const input = createEl("input", { attr: { type: "file", accept: ".json,application/json" } });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) void file.text().then((text) => this.importThemes(text));
    });
    input.click();
  }

  /** Branch colors that main topics take in turn: line and border, then main topic background. */
  private branchList(colors: Colors): SettingDefinitionItem {
    const branches = colors.branches;

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
