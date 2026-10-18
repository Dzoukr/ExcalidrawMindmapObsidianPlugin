import { test } from "node:test";
import assert from "node:assert/strict";
import type { LNode, PlacedInfo } from "../src/layout.ts";
import { BOUNDARY_PAD, BRACE_GAP, BRACE_W, RELATION_GAP, ROOT_H_GAP, TITLE_INSET, TITLE_OVERLAP, H_GAP, SUMMARY_GAP, V_GAP, computeLayout, findFreeSpot, relationBend, relationPoints, updateOffsets } from "../src/layout.ts";

const node = (id: string, side: "R" | "L" | null, children: LNode[] = []): LNode => ({ id, side, children });
const size = () => ({ w: 100, h: 40 });
const zero = () => ({ x: 0, y: 0 });

test("children are stacked and centered on the parent", () => {
  const root = node("r", null, [node("a", "R", [node("a1", "R"), node("a2", "R")])]);
  const b = computeLayout(root, size, zero, { x: 0, y: 0 }).boxes;
  assert.deepEqual(b.get("r"), { x: -50, y: -20, w: 100, h: 40 });
  const a = b.get("a")!;
  assert.equal(a.x, 50 + ROOT_H_GAP);
  assert.equal(a.y + a.h / 2, 0);
  const a1 = b.get("a1")!, a2 = b.get("a2")!;
  assert.equal(a1.x, a.x + a.w + H_GAP);
  assert.equal(a2.y - (a1.y + a1.h), V_GAP);
  assert.equal((a1.y + a2.y + a2.h) / 2, 0);
});

test("left branches mirror to the left of the root", () => {
  const root = node("r", null, [node("l", "L", [node("l1", "L")])]);
  const b = computeLayout(root, size, zero, { x: 0, y: 0 }).boxes;
  assert.equal(b.get("l")!.x + 100, -50 - ROOT_H_GAP);
  assert.equal(b.get("l1")!.x + 100, b.get("l")!.x - H_GAP);
});

test("offset moves the node together with its subtree", () => {
  const root = node("r", null, [node("a", "R", [node("a1", "R")])]);
  const plain = computeLayout(root, size, zero, { x: 0, y: 0 }).boxes;
  const moved = computeLayout(root, size, (id) => (id === "a" ? { x: 10, y: 30 } : { x: 0, y: 0 }), { x: 0, y: 0 }).boxes;
  for (const id of ["a", "a1"]) {
    assert.equal(moved.get(id)!.x - plain.get(id)!.x, 10);
    assert.equal(moved.get(id)!.y - plain.get(id)!.y, 30);
  }
});

test("summary sits beyond a brace spanning the covered subtrees, centered on them", () => {
  const sum = node("s", "R");
  const a = node("a", "R", [node("a1", "R"), node("a2", "R"), node("a3", "R")]);
  a.summaries = [{ node: sum, covers: ["a1", "a2"] }];
  const { boxes: b, braces } = computeLayout(node("r", null, [a]), size, zero, { x: 0, y: 0 });
  const a1 = b.get("a1")!, a2 = b.get("a2")!, s = b.get("s")!;
  const brace = braces.get("s")!;
  assert.deepEqual(brace, { x: a1.x + a1.w + BRACE_GAP, y: a1.y, w: BRACE_W, h: a2.y + a2.h - a1.y, side: "R" });
  assert.equal(s.x, brace.x + BRACE_W + SUMMARY_GAP);
  assert.equal(s.y + s.h / 2, (a1.y + a2.y + a2.h) / 2);
  assert.equal(b.get("a3")!.y - (a2.y + a2.h), V_GAP);
});

test("left summary mirrors and a taller summary subtree spreads the siblings", () => {
  const sum = node("s", "L", [node("s1", "L"), node("s2", "L"), node("s3", "L")]);
  const l = node("l", "L", [node("l1", "L"), node("l2", "L")]);
  l.summaries = [{ node: sum, covers: ["l1"] }];
  const { boxes: b, braces } = computeLayout(node("r", null, [l]), size, zero, { x: 0, y: 0 });
  const l1 = b.get("l1")!, s = b.get("s")!;
  const brace = braces.get("s")!;
  assert.equal(brace.x, l1.x - BRACE_GAP - BRACE_W);
  assert.equal(s.x + s.w, brace.x - SUMMARY_GAP);
  assert.equal(b.get("s1")!.x + 100, s.x - H_GAP);
  // l1's slot is as tall as the summary's three subtopics, so l2 starts below it.
  const slot = 3 * 40 + 2 * V_GAP;
  assert.equal(l1.y + l1.h / 2, b.get("s2")!.y + 20);
  assert.equal(b.get("l2")!.y, l1.y + l1.h / 2 + slot / 2 + V_GAP);
});

test("boundary frames the covered subtrees with its title on top and pushes siblings apart", () => {
  const a = node("a", "R", [node("a1", "R", [node("a1x", "R")]), node("a2", "R"), node("a3", "R")]);
  a.boundaries = [{ id: "b", covers: ["a1", "a2"] }];
  const sz = (id: string) => (id === "b" ? { w: 60, h: 24 } : { w: 100, h: 40 });
  const { boxes: x, boundaries } = computeLayout(node("r", null, [a]), sz, zero, { x: 0, y: 0 });
  const { frame, title } = boundaries.get("b")!;
  const a1 = x.get("a1")!, a2 = x.get("a2")!, a1x = x.get("a1x")!;
  assert.equal(frame.x, a1.x - BOUNDARY_PAD);
  assert.equal(frame.x + frame.w, a1x.x + a1x.w + BOUNDARY_PAD);
  assert.equal(frame.y, a1.y - BOUNDARY_PAD);
  assert.equal(frame.y + frame.h, a2.y + a2.h + BOUNDARY_PAD);
  assert.deepEqual(title, { x: frame.x + TITLE_INSET, y: frame.y - 24 + TITLE_OVERLAP, w: 60, h: 24 });
  assert.equal(x.get("a3")!.y - (frame.y + frame.h), V_GAP);
  // The covered range stays centered on the parent together with the room kept for the frame.
  const top = title.y, bottom = x.get("a3")!.y + 40;
  assert.equal((top + bottom) / 2, x.get("a")!.y + 20);
});

test("summary brace goes beyond a boundary on the same topics", () => {
  const a = node("a", "R", [node("a1", "R"), node("a2", "R")]);
  a.boundaries = [{ id: "b", covers: ["a1", "a2"] }];
  a.summaries = [{ node: node("s", "R"), covers: ["a1", "a2"] }];
  const { boundaries, braces } = computeLayout(node("r", null, [a]), size, zero, { x: 0, y: 0 });
  const { frame } = boundaries.get("b")!;
  assert.equal(braces.get("s")!.x, frame.x + frame.w + BRACE_GAP);
});

test("manual moves become offsets, moving with the parent does not", () => {
  const root = node("r", null, [node("a", "R", [node("a1", "R")]), node("b", "R")]);
  const info: Record<string, PlacedInfo> = {
    r: { x: 0, y: 0, lx: 0, ly: 0, ox: 0, oy: 0 },
    a: { x: 120, y: 50, lx: 100, ly: 0, ox: 0, oy: 0 }, // dragged by (20, 50)
    a1: { x: 220, y: 50, lx: 200, ly: 0, ox: 0, oy: 0 }, // dragged along with a
    b: { x: 100, y: 100, lx: 100, ly: 100, ox: 5, oy: 5 }, // untouched, keeps old offset
  };
  const o = updateOffsets(root, (id) => info[id]);
  assert.deepEqual(o.get("a"), { x: 20, y: 50 });
  assert.deepEqual(o.get("a1"), { x: 0, y: 0 });
  assert.deepEqual(o.get("b"), { x: 5, y: 5 });
});

test("free spot is the view center when nothing is in the way", () => {
  const view = { x: 0, y: 0, w: 1000, h: 800 };
  assert.deepEqual(findFreeSpot(view, [{ x: 2000, y: 0, w: 100, h: 100 }], { w: 200, h: 100 }, 20), { x: 500, y: 400 });
});

test("free spot avoids an existing map in the view center", () => {
  const view = { x: 0, y: 0, w: 1000, h: 800 };
  const taken = { x: 400, y: 350, w: 200, h: 100 };
  const size = { w: 200, h: 100 };
  const c = findFreeSpot(view, [taken], size, 20);
  const box = { x: c.x - 120, y: c.y - 70, w: 240, h: 140 };
  assert.ok(box.x >= taken.x + taken.w || box.x + box.w <= taken.x || box.y >= taken.y + taken.h || box.y + box.h <= taken.y);
  assert.ok(c.x - 100 >= 0 && c.x + 100 <= 1000 && c.y - 50 >= 0 && c.y + 50 <= 800);
});

test("free spot falls back to the right of everything when the view is full", () => {
  const view = { x: 0, y: 0, w: 1000, h: 800 };
  const c = findFreeSpot(view, [{ x: -100, y: -100, w: 1500, h: 1000 }], { w: 200, h: 100 }, 20);
  assert.deepEqual(c, { x: 1400 + 20 + 100, y: 400 });
});

test("a folded node hides its subtree and takes only its own height", () => {
  const sum = node("s", "R");
  const a = node("a", "R", [node("a1", "R"), node("a2", "R")]);
  a.summaries = [{ node: sum, covers: ["a1", "a2"] }];
  a.boundaries = [{ id: "f", covers: ["a1"] }];
  a.folded = true;
  const root = node("r", null, [a, node("b", "R")]);
  const { boxes: b, braces, boundaries } = computeLayout(root, size, zero, { x: 0, y: 0 });
  for (const id of ["a1", "a2", "s"]) assert.equal(b.has(id), false);
  assert.equal(braces.size, 0);
  assert.equal(boundaries.size, 0);
  const plain = computeLayout(node("r", null, [node("a", "R"), node("b", "R")]), size, zero, { x: 0, y: 0 }).boxes;
  assert.deepEqual(b.get("a"), plain.get("a"));
  assert.deepEqual(b.get("b"), plain.get("b"));
});

test("hidden nodes keep their offsets", () => {
  const a = node("a", "R", [node("a1", "R")]);
  a.folded = true;
  const info = (id: string): PlacedInfo => ({ x: 0, y: 0, lx: 0, ly: 0, ox: id === "a1" ? 7 : 0, oy: 0 });
  const o = updateOffsets(node("r", null, [a]), info);
  assert.equal(o.has("a1"), false);
});

test("a relationship leaves each box toward its bulging middle point", () => {
  const a = { x: 0, y: 0, w: 100, h: 40 };
  const b = { x: 300, y: 0, w: 100, h: 40 };
  const straight = relationPoints(a, b, 0);
  assert.deepEqual(straight.start, { x: 100 + RELATION_GAP, y: 20 });
  assert.deepEqual(straight.end, { x: 300 - RELATION_GAP, y: 20 });
  const curved = relationPoints(a, b, 0.2);
  assert.ok(curved.mid.y > 20); // bulges to one side
  assert.ok(curved.start.x > 50 && curved.end.x < 350);
});

test("the bend read back from a drawn relationship matches the one it was drawn with", () => {
  const { start, mid, end } = relationPoints({ x: 0, y: 0, w: 80, h: 30 }, { x: 200, y: 150, w: 80, h: 30 }, 0.3);
  const bend = relationBend([[0, 0], [mid.x - start.x, mid.y - start.y], [end.x - start.x, end.y - start.y]])!;
  assert.ok(Math.abs(bend - 0.3) < 1e-9);
  assert.equal(relationBend([[0, 0], [10, 10]]), null);
});
