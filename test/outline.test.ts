import { test } from "node:test";
import assert from "node:assert/strict";
import type { OutlineItem } from "../src/outline.ts";
import { isOutline, parseOutline, toMarkdown } from "../src/outline.ts";

const t = (text: string, ...children: OutlineItem[]): OutlineItem => ({ text, children });

test("nested bullets with tabs or spaces, numbered and task items", () => {
  assert.deepEqual(parseOutline("- a\n\t- a1\n\t\t- a11\n\t- a2\n- b"), [t("a", t("a1", t("a11")), t("a2")), t("b")]);
  assert.deepEqual(parseOutline("* a\n  + a1\n    1. x\n  2) a2"), [t("a", t("a1", t("x")), t("a2"))]);
  assert.deepEqual(parseOutline("- [ ] task"), [t("[ ] task")]);
});

test("a dedent goes back to the matching level", () => {
  assert.deepEqual(parseOutline("- a\n    - a1\n        - a11\n  - a2"), [t("a", t("a1", t("a11")), t("a2"))]);
});

test("headings nest by level, with lists and plain lines below them", () => {
  const md = "# Title\nintro\n## One\n- x\n  - y\n### Deep\n## Two\n---\n- z";
  assert.deepEqual(parseOutline(md), [
    t("Title", t("intro"), t("One", t("x", t("y")), t("Deep")), t("Two", t("z"))),
  ]);
});

test("indented plain lines continue a list item, others are items of their own", () => {
  assert.deepEqual(parseOutline("- a\n  more\n- b\nplain\n\nother\r\n"), [t("a\nmore"), t("b"), t("plain"), t("other")]);
});

test("markdown round trip keeps the structure and multi-line topics", () => {
  const items = [t("Central", t("A\nsecond line", t("A1")), t("B"))];
  const md = toMarkdown(items);
  assert.equal(md, "- Central\n\t- A\n\t  second line\n\t\t- A1\n\t- B");
  assert.deepEqual(parseOutline(md), items);
});

test("JSON and blank text are not outlines", () => {
  assert.equal(isOutline('{"type":"excalidraw/clipboard","elements":[]}'), false);
  assert.equal(isOutline("  \n "), false);
  assert.equal(isOutline("[link](x)"), true);
  assert.equal(isOutline("- a"), true);
});
