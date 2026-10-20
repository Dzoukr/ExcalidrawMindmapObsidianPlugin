# Changelog

## 1.4.0

### New

- **Duplicate (Ctrl+D, Cmd+D on Mac)** copies the selected topics with everything under them, right below the original: subtopics, summaries, boundaries, colors and collapsed topics. The copy joins the boundaries and summaries the original is in. On the central topic, it duplicates the whole map next to it. Relationships stay with the original. Also in the panel and the command palette.
- **Control panel position.** Dock the panel as a row at the bottom or top of the drawing, or as a column on its left or right side, in the settings. Its menus open toward the drawing.
- **Callouts.** Add a short note in a solid-colored bubble right above a topic, pointing down at it, like XMind's callout: from the panel or with the command "Add callout to selected topic". Its bubble and tail are grouped; it moves with its topic and the map makes room for it. Select it and press Space or Enter to edit it, or Delete to remove it; a callout edited to no text is removed too. Duplicating a topic copies its callout.
- **Themes.** Each map has its own theme: Classic, Pastel, Ocean, Sunset, Forest, Monochrome, or one of your own. Pick it from the panel's new **Theme** button or with the command "Change theme of the mind map"; the map is recolored at once and keeps its layout. New maps get the theme set in the settings.
- **Your own themes.** The **Colors** settings page is now **Themes**: add themes starting from any theme, reorder them, and rename, delete or set the colors of each on its page. Your earlier colors become the **Custom** theme, which existing maps keep.
- **Import and export themes** as JSON: copy all your themes to the clipboard or save them as a file in the vault, and import them from the clipboard or a file.
- **Control panel style.** Choose how the panel looks in the settings: Default, Accent color, High contrast, Translucent or Colorful icons.
- Callout colors in every theme.

### Changed

- A new boundary's frame and title are grouped, so they are selected and moved together. To resize the frame alone, double-click into the group. Space, Enter and F2 still edit the title.
- A narrower panel on phones and tablets, to fit the screen: the bar keeps New mind map and the buttons that add, edit and delete topics, summaries, boundaries and relationships. Copy, paste, duplicate, promote, demote, collapse, the layout settings and pause are in its **⋯** menu. On desktop every button stays in the bar.
- The four selection arrow buttons are gone from the panel; tap a topic to select it, or use the arrow keys.

## 1.3.0

### New

- **Drag a topic onto another topic** to make it a subtopic there, with its subtopics. The topic it will land on is outlined while dragging; dropped near a topic's top or bottom edge, it goes between topics as before. Dropped on the central topic, it becomes a main topic on that side. It leaves the boundaries and summaries it was in and takes the colors of its new branch.
- **Drop between maps.** Drop a topic on a topic of another map to move it, with its subtopics, boundaries and summaries, into that map. Drag a map's central topic onto another map's topic to make the whole map a branch there: its main topics become subtopics and take the look of their new level. Relationships stay connected.

### Changed

- A central topic with no other topics can be deleted even when deleting the central topic is off in the settings. Deleting a whole selected map still needs the setting.

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
