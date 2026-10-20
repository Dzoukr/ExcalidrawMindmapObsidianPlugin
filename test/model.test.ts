import { test } from "node:test";
import assert from "node:assert/strict";
import type { El } from "../src/excalidraw.ts";
import { KEY, balancedSplit, boundaryData, buildMap, calloutData, isHidden, nodeData, orderLine, rangesIn, rootIdOf, structureOf, titleData } from "../src/model.ts";

const el = (id: string, data: object, extra: Partial<El> = {}): El =>
  ({ id, type: "rectangle", x: 0, y: 0, width: 10, height: 10, customData: { [KEY]: data }, ...extra });

const scene = () => [
  el("r", { self: "r", root: "r", parent: null, order: 0 }),
  el("a", { self: "a", root: "r", parent: "r", order: 0, side: "R" }),
  el("b", { self: "b", root: "r", parent: "r", order: 1, side: "R" }),
  el("f", { boundary: true, self: "f", root: "r", parent: "r", topics: ["a", "b"] }),
  el("t", { boundaryTitle: true, self: "t", root: "r", boundary: "f" }, { boundElements: [{ id: "tt", type: "text" }] }),
  { id: "tt", type: "text", x: 0, y: 0, width: 5, height: 5, containerId: "t", text: "Title" } as El,
];

test("a boundary title is neither a node nor a boundary frame", () => {
  const [, , , frame, title] = scene();
  assert.equal(nodeData(title), null);
  assert.equal(boundaryData(title), null);
  assert.equal(titleData(title)?.boundary, "f");
  assert.equal(boundaryData(frame)?.parent, "r");
  assert.equal(nodeData(frame), null);
});

test("boundary keeps its title and is not stray", () => {
  const map = buildMap(scene(), "r")!;
  const b = map.boundaries.get("f")!;
  assert.deepEqual(b.covers, ["a", "b"]);
  assert.equal(b.title?.id, "t");
  assert.equal(b.titleText?.id, "tt");
  assert.deepEqual(map.strayBoundaries, []);
  assert.deepEqual(map.root.boundaries.map((x) => x.id), ["f"]);
});

test("boundary whose topics are all gone is stray, with its title", () => {
  const els = scene().map((e) => (e.id === "a" || e.id === "b" ? { ...e, isDeleted: true } : e));
  const map = buildMap(els, "r")!;
  assert.equal(map.boundaries.size, 0);
  assert.deepEqual(map.strayBoundaries.map((e) => e.id).sort(), ["f", "t"]);
});

test("only a topic with subtopics folds, never the central topic, and a stale badge is stray", () => {
  const els = [
    el("r", { self: "r", root: "r", parent: null, order: 0, folded: true }),
    el("a", { self: "a", root: "r", parent: "r", order: 0, side: "R", folded: true }),
    el("a1", { self: "a1", root: "r", parent: "a", order: 0 }),
    el("b", { self: "b", root: "r", parent: "r", order: 1, side: "R", folded: true }),
    el("ba", { badge: true, self: "ba", root: "r", node: "a" }),
    el("bb", { badge: true, self: "bb", root: "r", node: "b" }),
  ];
  const map = buildMap(els, "r")!;
  assert.equal(map.root.folded, false);
  assert.equal(map.nodes.get("a")!.folded, true);
  assert.equal(map.nodes.get("b")!.folded, false);
  assert.equal(isHidden(map.nodes.get("a1")!), true);
  assert.equal(isHidden(map.nodes.get("a")!), false);
  assert.deepEqual([...map.badges.keys()], ["a"]);
  assert.deepEqual(map.strayBadges.map((e) => e.id), ["bb"]);
  assert.equal(nodeData(els[4]), null);
});

/** A central topic with main topics a0, a1... in that order, each with the stored side given. */
const mains = (structure: string | undefined, sides: string[]) => [
  el("r", { self: "r", root: "r", parent: null, order: 0, ...(structure ? { structure } : {}) }),
  ...sides.map((side, i) => el(`a${i}`, { self: `a${i}`, root: "r", parent: "r", order: i, side })),
];
const shown = (els: El[]) => {
  const map = buildMap(els, "r")!;
  const ids = (side: string) => map.root.children.filter((c) => c.side === side).map((c) => c.id);
  return { R: ids("R"), L: ids("L"), map };
};

test("a map without a structure, or with an unknown one, is free and keeps the stored sides", () => {
  for (const s of [undefined, "spiral"]) {
    const { R, L, map } = shown(mains(s, ["L", "R", "L"]));
    assert.equal(structureOf(map.root), "free");
    assert.deepEqual(R, ["a1"]);
    assert.deepEqual(L, ["a0", "a2"]);
  }
});

test("a balanced map puts the first half right and the rest left, clockwise", () => {
  const { R, L } = shown(mains("balanced", ["L", "L", "L", "L", "L"]));
  assert.deepEqual(R, ["a0", "a1", "a2"]);
  assert.deepEqual(L, ["a4", "a3"]); // top to bottom: the left side runs against the order
});

test("a one-sided map shows every main topic on its side and keeps the stored sides", () => {
  const { R, L, map } = shown(mains("right", ["R", "L", "R"]));
  assert.deepEqual(R, ["a0", "a1", "a2"]);
  assert.deepEqual(L, []);
  assert.equal(map.nodes.get("a1")!.data.side, "L");
  assert.deepEqual(shown(mains("left", ["R", "L"])).L, ["a0", "a1"]);
});

test("a summary of main topics is on their side, whatever side it has stored", () => {
  const els = [
    ...mains("balanced", ["R", "R", "R", "R"]),
    el("s", { self: "s", root: "r", parent: "r", order: 0, side: "R", summary: ["a2", "a3"] }),
  ];
  const map = buildMap(els, "r")!;
  assert.equal(map.nodes.get("s")!.side, "L");
  assert.deepEqual(map.root.summaries[0].covers, ["a3", "a2"]);
});

test("the order line of a balanced map runs clockwise through all main topics", () => {
  const map = buildMap(mains("balanced", ["R", "R", "R", "R"]), "r")!;
  const right = orderLine(map.nodes.get("a1")!);
  assert.deepEqual(right.line.map((n) => n.id), ["a0", "a1", "a2", "a3"]);
  assert.equal(right.reversed, false);
  assert.equal(orderLine(map.nodes.get("a3")!).reversed, true);
  const free = buildMap(mains(undefined, ["R", "L", "R"]), "r")!;
  assert.deepEqual(orderLine(free.nodes.get("a2")!).line.map((n) => n.id), ["a0", "a2"]);
});

test("the balanced split is the middle, or the nearest place that cuts no range", () => {
  assert.equal(balancedSplit(5, []), 3);
  assert.equal(balancedSplit(4, [[1, 2]]), 3); // 2 would cut it, 3 is as near and further right
  assert.equal(balancedSplit(6, [[1, 4]]), 5);
  assert.equal(balancedSplit(3, [[0, 2]]), 3); // one range of all: all right
  assert.deepEqual(rangesIn([{ id: "a" }, { id: "b" }, { id: "c" }], [["c", "a"], ["x"], ["b", "x"]]), [[0, 2], [1, 1]]);
});

test("a balanced map keeps a boundary of main topics on one side", () => {
  const els = [
    ...mains("balanced", ["R", "R", "R", "R"]),
    el("f", { boundary: true, self: "f", root: "r", parent: "r", topics: ["a1", "a2"] }),
  ];
  const { R, L, map } = shown(els);
  assert.deepEqual(R, ["a0", "a1", "a2"]);
  assert.deepEqual(L, ["a3"]);
  assert.deepEqual(map.boundaries.get("f")!.covers, ["a1", "a2"]);
});

test("a callout belongs to its topic, with its tail; it is no topic itself", () => {
  const els = [
    el("r", { self: "r", root: "r", parent: null, order: 0 }),
    el("a", { self: "a", root: "r", parent: "r", order: 0, side: "R" }),
    el("c", { callout: true, self: "c", root: "r", node: "a" }, { boundElements: [{ id: "ct", type: "text" }] }),
    { id: "ct", type: "text", x: 0, y: 0, width: 5, height: 5, containerId: "c", text: "Note" } as El,
    el("t", { calloutTail: true, root: "r", callout: "c" }, { type: "line" }),
  ];
  assert.equal(nodeData(els[2]), null);
  assert.equal(calloutData(els[2])?.node, "a");
  assert.equal(rootIdOf(els[2]), "r");
  assert.equal(rootIdOf(els[4]), "r");
  const map = buildMap(els, "r")!;
  assert.equal(map.nodes.size, 2);
  const c = map.callouts.get("a")!;
  assert.equal(c.text?.id, "ct");
  assert.equal(c.tail?.id, "t");
  assert.equal(map.nodes.get("a")!.callout, "c");
  assert.deepEqual(map.strayCallouts, []);
});

test("a callout without its topic, a second one, one on a summary and a tail without a bubble are stray", () => {
  const els = [
    el("r", { self: "r", root: "r", parent: null, order: 0 }),
    el("a", { self: "a", root: "r", parent: "r", order: 0, side: "R" }),
    el("s", { self: "s", root: "r", parent: "r", order: 0, side: "R", summary: ["a"] }),
    el("c1", { callout: true, self: "c1", root: "r", node: "a" }),
    el("c2", { callout: true, self: "c2", root: "r", node: "a" }),
    el("c3", { callout: true, self: "c3", root: "r", node: "gone" }),
    el("c4", { callout: true, self: "c4", root: "r", node: "s" }),
    el("t", { calloutTail: true, root: "r", callout: "c3" }, { type: "line" }),
  ];
  const map = buildMap(els, "r")!;
  assert.deepEqual([...map.callouts.keys()], ["a"]);
  assert.deepEqual(map.strayCallouts.map((e) => e.id).sort(), ["c2", "c3", "c4", "t"]);
});
