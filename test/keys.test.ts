import { test } from "node:test";
import assert from "node:assert/strict";
import type { KeyLike } from "../src/keys.ts";
import { DEFAULT_SHORTCUTS, conflicts, formatShortcut, matchesShortcut, mergeShortcuts, parseShortcut, shortcutOf, typesText } from "../src/keys.ts";

const key = (k: string, code: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: k, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

test("parses modifiers and the key, which can be +", () => {
  assert.deepEqual(parseShortcut("Mod+Alt+ArrowUp"), { mod: true, alt: true, shift: false, key: "ArrowUp" });
  assert.deepEqual(parseShortcut("Mod++"), { mod: true, alt: false, shift: false, key: "+" });
  assert.deepEqual(parseShortcut("+"), { mod: false, alt: false, shift: false, key: "+" });
  assert.equal(parseShortcut("Ctrl+D"), null);
  assert.equal(parseShortcut(""), null);
});

test("records what the user presses", () => {
  assert.equal(shortcutOf(key("d", "KeyD", { ctrlKey: true })), "Mod+D");
  assert.equal(shortcutOf(key("D", "KeyD", { metaKey: true, shiftKey: true })), "Mod+Shift+D");
  assert.equal(shortcutOf(key(" ", "Space")), "Space");
  assert.equal(shortcutOf(key("Enter", "Enter", { shiftKey: true })), "Shift+Enter");
  // Shift is part of the character it types.
  assert.equal(shortcutOf(key("!", "Digit1", { shiftKey: true })), "!");
  // Option on Mac types another character: the physical key names it.
  assert.equal(shortcutOf(key("∂", "KeyD", { altKey: true })), "Alt+D");
  assert.equal(shortcutOf(key("Control", "ControlLeft", { ctrlKey: true })), null);
  assert.equal(shortcutOf(key("Escape", "Escape")), null);
});

test("matches with Ctrl or Cmd, exact modifiers, and the physical key on other layouts", () => {
  assert.ok(matchesShortcut(key("d", "KeyD", { ctrlKey: true }), "Mod+D"));
  assert.ok(matchesShortcut(key("d", "KeyD", { metaKey: true }), "Mod+D"));
  assert.ok(!matchesShortcut(key("d", "KeyD", { ctrlKey: true, shiftKey: true }), "Mod+D"));
  assert.ok(!matchesShortcut(key("d", "KeyD"), "Mod+D"));
  // Czech layout: Ctrl with the key where US has the slash types "-".
  assert.ok(matchesShortcut(key("-", "Slash", { ctrlKey: true }), "Mod+/"));
  // Czech layout: "/" itself needs Shift.
  assert.ok(matchesShortcut(key("/", "BracketLeft", { ctrlKey: true, shiftKey: true }), "Mod+/"));
  // Without a modifier, only the character counts.
  assert.ok(!matchesShortcut(key("-", "Slash"), "/"));
  assert.ok(matchesShortcut(key("Enter", "Enter"), "Enter"));
  assert.ok(!matchesShortcut(key("Enter", "Enter", { shiftKey: true }), "Enter"));
  assert.ok(matchesShortcut(key("Enter", "Enter", { shiftKey: true }), "Shift+Enter"));
  assert.ok(matchesShortcut(key(" ", "Space"), "Space"));
  assert.ok(matchesShortcut(key("ArrowUp", "ArrowUp", { altKey: true }), "Alt+ArrowUp"));
  assert.ok(!matchesShortcut(key("ArrowUp", "ArrowUp"), "Alt+ArrowUp"));
});

test("shortcuts that type text", () => {
  assert.ok(typesText("Space"));
  assert.ok(typesText("N"));
  assert.ok(!typesText("Mod+N"));
  assert.ok(!typesText("Enter"));
});

test("formats for the platform", () => {
  assert.equal(formatShortcut("Mod+/", false), "Ctrl+/");
  assert.equal(formatShortcut("Mod+Alt+ArrowUp", true), "Cmd+Option+Up");
});

test("merges saved shortcuts over the defaults", () => {
  const merged = mergeShortcuts({ addChild: ["Mod+Enter", "Mod+Enter", "bogus+X", 3], edit: [], remove: "Delete" });
  assert.deepEqual(merged.addChild, ["Mod+Enter"]);
  assert.deepEqual(merged.edit, []);
  assert.deepEqual(merged.remove, DEFAULT_SHORTCUTS.remove);
  assert.deepEqual(mergeShortcuts(null), DEFAULT_SHORTCUTS);
  assert.notEqual(mergeShortcuts(null).addChild, DEFAULT_SHORTCUTS.addChild);
});

test("conflicts only where both actions would take the key", () => {
  assert.deepEqual(conflicts(DEFAULT_SHORTCUTS, "addChild", "Enter"), ["addSibling", "finishEditing"]);
  assert.deepEqual(conflicts(DEFAULT_SHORTCUTS, "duplicate", "Enter"), ["addSibling"]);
  assert.deepEqual(conflicts(DEFAULT_SHORTCUTS, "finishEditing", "Tab"), ["addChild"]);
  assert.deepEqual(conflicts(DEFAULT_SHORTCUTS, "finishEditing", "Delete"), []);
});
