# Excalidraw Mind Map

Obsidian plugin that adds XMind-style mind map editing to Excalidraw drawings. Requires the Excalidraw plugin (tested with 2.29.0).

## Usage

Open a drawing and click **New mind map** in the floating panel, or run the command "Insert new mind map".

| Key | Action |
|---|---|
| Tab / Insert | Add child |
| Enter | Add sibling below |
| Shift+Enter | Add sibling above |
| Delete / Backspace | Delete node with its subtopics (the central topic deletes the whole map, if enabled in settings) |
| F2 / Space | Edit text |
| Arrow keys | Move selection (right/left = child/parent, mirrored on the left side) |
| Alt+Up / Alt+Down | Move the topic up or down among its siblings |

**Add summary** in the panel (or the command "Add summary to selected topics") works like XMind's Summary: select one or more sibling topics and it adds a summary topic behind a brace spanning them, and any topics between them. A summary can have its own subtopics. A sibling added to a summarized topic (Enter / Shift+Enter) joins the summary, while a topic added to the parent (Tab / Insert) stays outside it. Deleting all the topics it spans deletes the summary too.

While editing text: Enter commits, Shift+Enter adds a line break, Tab/Insert commits and adds a child.

Layout runs automatically after every change. Nodes can be dragged freely. The offset is remembered, and the node's subtree follows it. The layout button in the panel offers two modes. **Refresh layout** re-runs the layout and keeps those moves, which is useful after editing with plain Excalidraw tools (dragging a branch, changing a font size, deleting a connector). **Reset layout** discards the moves and puts topics back to their automatic positions, for the selected subtree or for all maps when nothing is selected.

Every operation is a single undo step.

Colors are set in the plugin settings: the central topic (text, border, background), the topic text, summaries (text, border and brace, background), and the branch colors that main topics take in turn. Changes apply to topics created afterwards. The setting "Arrows instead of lines" puts an arrowhead on connectors created afterwards.

## Data model

- Node: rectangle with bound text, `customData.mindmap = { self, root, parent, order, side, ox, oy, lx, ly }`.
- Summary: a node whose `parent` is the parent of the topics it spans, with `summary` listing their ids. The range runs from the first to the last still present.
- Connector: arrow bound to both nodes, `customData.mindmap = { edge, root, parent, child }`.
- Brace: line next to the summarized topics, `customData.mindmap = { brace, root, summary }`.
- Copies of nodes (paste, Alt-drag) are ignored by the mind map, because `self` no longer matches the element id.

## Development

```
npm install
npm run dev     # watch build, copies into test-vault/.obsidian/plugins/excalidraw-mindmap
npm run build   # type-check + production build
npm test        # layout unit tests
```

To install into a vault, copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/excalidraw-mindmap/`.
