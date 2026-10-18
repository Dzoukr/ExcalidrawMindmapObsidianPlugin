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
| Alt+Left / Alt+Right | Promote or demote the topic (toward or away from the central topic, mirrored on the left side) |
| Ctrl+/ (Cmd+/ on Mac) | Collapse or expand the topic |

**Add summary** in the panel (or the command "Add summary to selected topics") works like XMind's Summary: select one or more sibling topics and it adds a summary topic behind a brace spanning them, and any topics between them. A summary can have its own subtopics. A sibling added to a summarized topic (Enter / Shift+Enter) joins the summary, while a topic added to the parent (Tab / Insert) stays outside it. Deleting all the topics it spans deletes the summary too.

**Add boundary** (or the command "Add boundary around selected topics") draws a dashed frame with a title tab around the selected sibling topics, any topics between them, and their subtopics, like XMind's Boundary. The title is edited right away. Select the frame or its title to edit the title (Space / F2) or delete the boundary (Delete), which keeps the topics. Siblings added with Enter join the boundary, and boundaries can be nested.

**Promote** (Alt+arrow toward the central topic, a panel button, or a command) makes the topic, with its subtopics, a sibling of its parent, placed right after it; a main topic can't be promoted. **Demote** (Alt+arrow away from the central topic) makes it the last subtopic of the sibling above, expanding that sibling if it's collapsed. A summary or boundary spanning only the moved topic is removed. A topic that becomes a main topic gets the next branch color and the main topic look, and one that stops being a main topic gets the subtopic look and the color of its new branch; its subtopics take the new color too. Other moves keep the styling.

**Collapse** (Ctrl+/, the fold button in the panel, or the command "Collapse or expand selected topic") works as a toggle, like XMind's Collapse/Expand. On a topic it collapses the topic together with everything below it, hiding its subtopics, summaries and boundaries; the same key or button expands it all again. On the central topic, which can't be collapsed itself, it collapses or expands all main topics. A badge next to a collapsed topic shows how many topics are hidden, and clicking it expands the topic. Adding a subtopic to a collapsed topic expands it as well.

The last button in the panel (or the command "Pause or resume mind map editing") pauses the plugin: its keys are left to Excalidraw, text edits no longer re-run the layout, and the other buttons are disabled until you resume. A restart resumes it too.

While editing text: Enter commits, Shift+Enter adds a line break, Tab/Insert commits and adds a child.

Layout runs automatically after every change. Nodes can be dragged freely. The offset is remembered, and the node's subtree follows it. The layout button in the panel offers two modes. **Refresh layout** re-runs the layout and keeps those moves, which is useful after editing with plain Excalidraw tools (dragging a branch, changing a font size, deleting a connector). **Reset layout** discards the moves and puts topics back to their automatic positions, for the selected subtree or for all maps when nothing is selected.

Every operation is a single undo step.

Colors are set in the plugin settings: the central topic (text, border, background), the topic text, summaries (text, border and brace, background), boundaries (line, background, title text, title background), and the branch colors that main topics take in turn. Changes apply to topics created afterwards. The setting "Arrows instead of lines" puts an arrowhead on connectors created afterwards.

## Data model

- Node: rectangle with bound text, `customData.mindmap = { self, root, parent, order, side, folded, ox, oy, lx, ly }`.
- Summary: a node whose `parent` is the parent of the topics it spans, with `summary` listing their ids. The range runs from the first to the last still present.
- Connector: arrow bound to both nodes, `customData.mindmap = { edge, root, parent, child }`.
- Brace: line next to the summarized topics, `customData.mindmap = { brace, root, summary }`.
- Boundary: dashed rectangle behind the map, `customData.mindmap = { boundary, self, root, parent, topics }`, and its title, a rectangle with bound text, `customData.mindmap = { boundaryTitle, self, root, boundary }`.
- Fold badge: ellipse with bound text next to a collapsed topic, `customData.mindmap = { badge, self, root, node }`.
- Hidden elements (everything under a collapsed topic) get opacity 0 and are locked; their own opacity and lock are kept in `customData.mindmapHidden` and restored when shown again.
- Copies of nodes (paste, Alt-drag) are ignored by the mind map, because `self` no longer matches the element id.

## Development

```
npm install
npm run dev     # watch build, copies into test-vault/.obsidian/plugins/excalidraw-mindmap
npm run build   # type-check + production build
npm test        # layout unit tests
```

To install into a vault, copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/excalidraw-mindmap/`.
