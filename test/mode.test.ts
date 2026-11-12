import { test } from "node:test";
import assert from "node:assert/strict";
import { CONVENTION_VERSION, MODE_KEY, isAlone, ownerOf, register, registry } from "../src/mode.ts";

test("the kind in the frontmatter decides whom a drawing belongs to", () => {
  assert.equal(MODE_KEY, "dzoukr-diagram-kind");
  assert.equal(ownerOf("mindmap", false, false), "mine");
  assert.equal(ownerOf(" MindMap ", false, false), "mine");
  assert.equal(ownerOf("c4", true, true), "other", "even with mind map elements in it, and alone");
});

test("without a kind, a drawing with mind map elements is the mind map's; any other is nobody's, unless the mind map is alone", () => {
  assert.equal(ownerOf(undefined, true, false), "mine");
  assert.equal(ownerOf("", false, false), "none");
  assert.equal(ownerOf("  ", false, false), "none");
  assert.equal(ownerOf(42, false, false), "none", "a kind that is no text is no kind");
  assert.equal(ownerOf(undefined, false, false), "none");
  assert.equal(ownerOf(undefined, false, true), "mine", "alone, as if no other plugin were installed");
});

test("the plugins of their own kind of diagram find each other in a registry on the window, with their version", () => {
  const host = {};
  assert.ok(isAlone(host));
  const unregister = register(host);
  assert.deepEqual(registry(host).get("mindmap"), { version: CONVENTION_VERSION });
  assert.ok(isAlone(host));
  registry(host).set("c4", { version: 1 });
  assert.ok(!isAlone(host));
  unregister();
  assert.ok(!registry(host).has("mindmap"));
  registry(host).delete("c4");
  assert.ok(isAlone(host));
});

test("a registry another plugin made first is shared, not replaced", () => {
  const host = {};
  const kinds = registry(host);
  kinds.set("c4", { version: 1 });
  const unregister = register(host);
  assert.equal(registry(host), kinds);
  assert.deepEqual([...kinds.keys()].sort(), ["c4", "mindmap"]);
  unregister();
  assert.deepEqual([...kinds.keys()], ["c4"]);
});
