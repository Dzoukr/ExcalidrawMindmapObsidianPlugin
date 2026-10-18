// Markdown outlines to topic trees and back, no Obsidian or Excalidraw dependencies (unit-tested in test/outline.test.ts).

export interface OutlineItem {
  text: string;
  children: OutlineItem[];
}

const HEADING = /^(#{1,6})\s+(.*?)(?:\s+#+)?$/;
const BULLET = /^(?:[-*+]|\d+[.)])\s+(.*)$/;
const RULE = /^([-*_])(?:\s*\1){2,}$/;
const LIST_LEVEL = 10; // list items and plain lines nest below any heading

/** Width of the leading whitespace, a tab counting as four columns. */
function indentOf(line: string): number {
  let w = 0;
  for (const ch of line) {
    if (ch === " ") w++;
    else if (ch === "\t") w += 4;
    else break;
  }
  return w;
}

/**
 * Parses headings, bullet and numbered lists nested by indentation, and plain lines into a tree.
 * Headings nest by level, lists below the heading they follow. A plain line indented under
 * a list item continues the item's text on a new line; other plain lines are items of their own.
 */
export function parseOutline(md: string): OutlineItem[] {
  const top: OutlineItem[] = [];
  const open: { level: number; item: OutlineItem }[] = [];
  let indents: number[] = []; // indentation of the open list levels
  let last: { item: OutlineItem; indent: number } | null = null; // list item that indented lines continue

  const add = (level: number, text: string): OutlineItem => {
    const item: OutlineItem = { text, children: [] };
    while (open.length && open[open.length - 1].level >= level) open.pop();
    (open.length ? open[open.length - 1].item.children : top).push(item);
    open.push({ level, item });
    return item;
  };

  for (const raw of md.replace(/\r\n?/g, "\n").split("\n")) {
    const content = raw.trim();
    if (!content || RULE.test(content)) continue;
    const indent = indentOf(raw);
    const h = indent < 4 ? HEADING.exec(content) : null;
    if (h) {
      add(h[1].length, h[2]);
      indents = [];
      last = null;
      continue;
    }
    const b = BULLET.exec(content);
    if (b) {
      while (indents.length && indents[indents.length - 1] > indent) indents.pop();
      if (!indents.length || indents[indents.length - 1] < indent) indents.push(indent);
      last = { item: add(LIST_LEVEL + indents.length - 1, b[1].trim()), indent };
      continue;
    }
    if (last && indent > last.indent) {
      last.item.text += "\n" + content;
      continue;
    }
    add(LIST_LEVEL, content);
    indents = [];
    last = null;
  }
  return top;
}

/** Bullet list indented with tabs, like Obsidian's; the further lines of a topic continue its item. */
export function toMarkdown(items: OutlineItem[]): string {
  const out: string[] = [];
  const walk = (it: OutlineItem, depth: number) => {
    const pad = "\t".repeat(depth);
    const [first, ...rest] = it.text.split("\n");
    out.push(`${pad}- ${first}`);
    for (const line of rest) if (line.trim()) out.push(`${pad}  ${line}`);
    for (const c of it.children) walk(c, depth + 1);
  };
  for (const it of items) walk(it, 0);
  return out.join("\n");
}

/** Whether pasted text should become topics: anything but blank text and JSON, such as Excalidraw's own clipboard. */
export function isOutline(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      JSON.parse(t);
      return false;
    } catch {
      // not JSON after all
    }
  }
  return true;
}
