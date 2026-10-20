# Changelog

## 1.2.0

### New

- **Structures.** Each map has its own structure: **Balanced** (main topics split evenly between the right and left side, clockwise, like XMind), **Free** (each main topic stays on the side you put it on), **Right** or **Left** (all main topics on one side). Pick it from the panel's layout settings or with the command "Change structure of the mind map". When the drawing has only one map, nothing needs to be selected. New maps get the structure set in the settings.
- **Auto-align.** With auto-align on, every topic keeps its automatic place, evenly spaced, and dropping a topic moves it among its siblings by the height you drop it at. With it off, a dropped topic stays where you put it. Each map has its own, toggled from the panel's layout settings or the command palette; new maps take the default from the settings, which is on.
- **Drag a main topic across the central topic** to move it to the other side, in a balanced or free map.
- **Boundaries by dragging.** Drag a topic out of a boundary's frame to take it out, or drag a sibling in to add it. Resize the frame to take in exactly the topics inside it. Move the frame to move its topics along, even to the other side of the central topic.
- **Summaries by dragging.** Drag a topic above or below a summary's brace to take it out of the summary, or next to the brace to add it.
- **Alt+Up / Alt+Down on a boundary** moves the boundary with its topics among their siblings.
- **Relationships to boundaries.** A relationship can connect topics and boundaries in any combination. Drag either end onto another topic or boundary to reconnect it.
- **Layout settings** in the panel replace the Reset layout button: structure, auto-align, Reset layout and Reset all in one menu.

### Changed

- Every drop lays out the map, so subtopics follow their topic right away. Moving the central topic brings the whole map along.
- Alt+Up / Alt+Down never changes what a topic belongs to: it stays in its boundaries and summaries, and moves past one it isn't in as a whole. Dragging takes a topic in or out.
- A promoted topic joins the boundaries and summaries its old parent is in.
- In a balanced map, a boundary or summary of main topics keeps them on one side, even if that leaves the sides a topic or two apart.
- "Reset sizes only" left the panel menu; the command "Refresh mind map layout" still does it.

### Fixed

- Connectors of a topic that changed sides stay glued to the facing sides instead of being pulled back to the old ones when a topic is dragged.
- A reconnected relationship no longer snaps back to its old topic.
- Summaries stay whole when their topics leave or join a boundary, or change sides.
- Topics no longer slip into a boundary or summary by being moved next to it, or out of one by being moved within it.

### Compatibility

- Maps made with earlier versions open as **Free** with auto-align **off**, so they look and behave as before. The only difference is that a drop now lays out the map.
- Undoing a drag takes two steps: the layout after the drop, then the drag itself.
- An earlier version of the plugin opening a map made with this one shows it as a two-sided free map, and deletes relationships connected to a boundary the next time it lays the map out.
