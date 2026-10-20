# Excalidraw Mind Map

Obsidian plugin that adds XMind-style mind map editing to Excalidraw drawings. Requires the Excalidraw plugin.

![](docs/mindmap.png)

## Usage

Open a drawing and click **New mind map** in the floating panel, or run the command "Insert new mind map".

| Key | Action |
|---|---|
| Tab / Insert | Add child |
| Enter | Add sibling below |
| Shift+Enter | Add sibling above |
| Delete / Backspace | Delete the selected topics with their subtopics (the central topic deletes the whole map, if enabled in settings) |
| Ctrl+C / Ctrl+X | Copy or cut the selected topics as a Markdown bullet list |
| Ctrl+V | Paste a Markdown outline or text as subtopics of the selected topic |
| F2 / Space | Edit text |
| Arrow keys | Move selection (right/left = child/parent, mirrored on the left side) |
| Alt+Up / Alt+Down | Move the topic, or the selected boundary with its topics, up or down among its siblings. It stays in its boundaries and summaries, and moves past one it isn't in as a whole; drag it to take it in or out |
| Alt+Left / Alt+Right | Promote or demote the topic (toward or away from the central topic, mirrored on the left side) |
| Ctrl+/ (Cmd+/ on Mac) | Collapse or expand the topic |

## Key Features

### ⌨️ Keyboard-first editing

Build a whole map without touching the mouse, with the shortcuts you know from XMind. Add children and siblings, edit text, delete branches, move between topics and reorder them. While editing, Enter commits the text and Tab commits it and adds a child.

### 📐 Automatic layout

The map re-arranges itself after every change, and after every drop: subtopics always follow their topic. The **Layout settings** button in the panel sets the map's structure and auto-align, and resets the layout or, with **Reset all**, the whole map.

With **Auto-align** on, every topic keeps its automatic place, evenly spaced. Dropping a topic moves it among its siblings by the height you drop it at. With it off, a dropped topic stays where you put it, until you reset the layout. Each map has its own; new maps take the default from the settings, and maps made before version 1.2 have it off.

### 🧭 Structures

Each map has its own structure, chosen from the panel's layout settings or with the command "Change structure of the mind map". It applies to the map of the selected topic; when the drawing has only one map, nothing needs to be selected.

- **Balanced**: main topics are split evenly between the right and left side, clockwise from the top right, like XMind's balanced map. A boundary or summary of main topics keeps them on one side, even if that leaves the sides a topic or two apart. Drag a main topic across the central topic and it moves to that side, trading places with a topic there to keep the balance.
- **Free**: each main topic stays on the side you put it on. Drag a main topic across the central topic to move it to the other side; it stays there.
- **Right** and **Left**: all main topics on one side.

New maps get the structure set in the settings. Maps made before version 1.2 are free.

### 🧩 Summaries, boundaries and relationships

Select sibling topics to add a **summary**, a topic behind a brace that spans them; drag a topic above or below the brace to take it out, or next to the brace to add it. Or add a **boundary**, a dashed frame with a title around them; drag a topic out of the frame to take it out of the boundary, or drag a sibling in to add it. Resize the frame to take in exactly the topics inside it, or move it to move its topics along, even to the other side. A **relationship** is a curved, labeled arrow between any two topics or boundaries, even in different maps, and it stays attached when they move. Drag either end onto another topic or boundary to reconnect it.

### 🪗 Collapse and expand

Ctrl+/ collapses a topic with everything below it. A badge shows how many topics are hidden, and clicking it expands the topic again. On the central topic, it collapses or expands all main topics at once.

### ↔️ Promote and demote

Alt+arrow moves a topic, with its subtopics, one level up or down. A topic that becomes a main topic takes the next branch color, and one that moves under another branch takes that branch's color.

### 📝 Markdown outlines

Ctrl+C copies the selected topics as a Markdown bullet list, ready to paste into a note. Ctrl+V pastes bullet lists, numbered lists or headings back as subtopics of the selected topic. A command builds a whole new map from the outline in the clipboard.

### 🔗 Links to notes

Type `[[` in a topic to open Excalidraw's link suggester for notes, headings, blocks and tags. Ctrl+click the topic to open the note. Links are kept when topics are copied as Markdown and pasted back.

### 🎨 Your colors

Pick the colors of the central topic, branches, summaries, boundaries and relationships in the settings. **Reset all** restyles existing maps with them.

### 📱 Works on mobile

A floating panel at the bottom of the drawing offers every action. On phones and tablets you can build maps without a keyboard.

### ✏️ Still plain Excalidraw

Maps are ordinary Excalidraw elements, so every Excalidraw tool still works on them. Every operation is a single undo step. Pause the plugin from the panel when you want Excalidraw's own shortcuts back.

## Configuration

All options are in **Settings → Excalidraw Mind Map**.

| Setting | Default | Description |
|---|---|---|
| Show control panel on desktop | On | Shows the floating panel on desktop. On phones and tablets it is always shown. |
| Allow deleting the central topic | Off | Lets Delete remove the central topic, which deletes the whole map: every topic and connector. |
| Structure of new maps | Balanced | How main topics are placed around the central topic: balanced, free, right or left. Each map keeps its own. |
| Auto-align new maps | On | Topics keep their automatic places and a drop moves a topic among its siblings, instead of leaving it where it is dropped. Each map keeps its own. |
| Arrows instead of lines | Off | Connectors end in an arrowhead pointing to the subtopic. |

**Colors** are on their own page in the settings, for:

- the central topic: text, border and background
- the topic text of main topics and subtopics
- summaries: text, border and brace, background
- boundaries: dashed line, background, title text, title background
- relationships: line and arrowhead, label text
- branches: line and border, and main topic background. Main topics take the branch colors in turn. Branch colors can be added, removed and reordered, and **Reset colors to defaults** restores the original palette.

Color and arrow changes apply to topics and connectors created afterwards. To apply them to an existing map, use **Reset all** from the panel's layout settings or the command palette.

## Development

```
npm install
npm run dev     # watch build, copies into test-vault/.obsidian/plugins/excalidraw-mindmap
npm run build   # type-check + production build
npm test        # layout unit tests
npm run lint    # ESLint with Obsidian's plugin rules
```

To install into a vault manually, copy `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/Dzoukr/ExcalidrawMindmapObsidianPlugin/releases/latest) into `<vault>/.obsidian/plugins/excalidraw-mindmap/`.

## License

[MIT](LICENSE)
