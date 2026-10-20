import { test } from "node:test";
import assert from "node:assert/strict";
import { CUSTOM_THEME, DEFAULT_COLORS, colorsOf, mergeColors, parseThemes, presetColors, setUserThemes, themeIn, themeOptions, themesToJson, uniqueName } from "../src/styles.ts";

test("missing or broken colors get their defaults, and the old single relationship color is used for both", () => {
  const c = mergeColors({ central: { text: "#123456", border: 5 }, relationship: "#abcdef", branches: [{ stroke: "#111111" }] });
  assert.equal(c.central.text, "#123456");
  assert.equal(c.central.border, DEFAULT_COLORS.central.border);
  assert.deepEqual(c.relationship, { line: "#abcdef", text: "#abcdef" });
  assert.deepEqual(c.callout, DEFAULT_COLORS.callout);
  assert.deepEqual(c.branches, [{ stroke: "#111111", fill: DEFAULT_COLORS.branches[0].fill }]);
  assert.deepEqual(mergeColors(undefined), DEFAULT_COLORS);
});

test("exported themes import back with their names and colors, without ids", () => {
  const ocean = presetColors("ocean");
  const json = themesToJson([{ id: "theme-x", name: "Mine", colors: ocean } as never]);
  assert.equal(json.includes("theme-x"), false);
  assert.deepEqual(parseThemes(json), [{ name: "Mine", colors: ocean }]);
});

test("a single theme or a list of them imports too; anything else is no theme", () => {
  assert.equal(parseThemes(JSON.stringify({ name: "One", colors: {} }))?.[0].name, "One");
  assert.equal(parseThemes(JSON.stringify([{ colors: {} }, { colors: {} }]))?.length, 2);
  assert.equal(parseThemes(JSON.stringify([{ colors: {} }]))?.[0].name, "Imported theme");
  for (const text of ["not json", "{}", "[]", JSON.stringify({ name: "No colors" }), "null"]) assert.equal(parseThemes(text), null);
});

test("a map without a theme has Custom, a theme that is gone has the Classic colors", () => {
  const mine = mergeColors({ topicText: "#ff0000" });
  setUserThemes([{ id: CUSTOM_THEME, name: "Custom", colors: mine }]);
  assert.equal(themeIn({ self: "r", root: "r", parent: null, order: 0 }), CUSTOM_THEME);
  assert.equal(colorsOf(CUSTOM_THEME), mine);
  assert.deepEqual(colorsOf("theme-gone"), DEFAULT_COLORS);
  assert.deepEqual(themeOptions().map((t) => t.id).slice(-2), ["monochrome", CUSTOM_THEME]);
  setUserThemes([]);
});

test("a taken name gets a number", () => {
  assert.equal(uniqueName("Ocean", ["Sunset"]), "Ocean");
  assert.equal(uniqueName("Ocean", ["Ocean", "Ocean 2"]), "Ocean 3");
});

test("callout colors from before callouts lost their border take the new defaults", () => {
  assert.deepEqual(mergeColors({ callout: { text: "#000000", border: "#f08c00", fill: "#fff3bf" } }).callout, DEFAULT_COLORS.callout);
  assert.deepEqual(mergeColors({ callout: { text: "#000000", fill: "#123456" } }).callout, { text: "#000000", fill: "#123456" });
});
