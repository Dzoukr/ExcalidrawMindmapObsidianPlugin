import { test } from "node:test";
import assert from "node:assert/strict";
import type { El } from "../src/excalidraw.ts";
import { KEY, boundaryData, buildMap, nodeData, titleData } from "../src/model.ts";

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
