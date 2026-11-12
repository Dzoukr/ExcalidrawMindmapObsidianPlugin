// The place on a drawing nobody's yet where each plugin drawing its own kind of diagram offers to take it over: one
// row shared by all of them, so their buttons never cover each other. A convention the plugins follow without knowing
// each other (see `mode.ts`):
//
// - The row is the `div.dzoukr-diagram-chooser` in the view's content element. The first plugin to offer creates
//   it; the last to leave removes it.
// - Each plugin puts one `button.dzoukr-diagram-choice` in it, its kind in `data-kind`, kept in the order of the
//   kinds, and takes it out once the drawing is anybody's.
// - Last in the row, the choice of none of them: plain Excalidraw, of the kind `excalidraw`, which every plugin leaves
//   alone as it does any kind not its own. Whichever plugin offers first puts it there, its own kind in `data-owner`,
//   and takes it out when it leaves; another one offering then puts it back.
// - Each plugin styles the row and its buttons with the same rules, so it looks the same whichever plugin made it.

const ROW = "dzoukr-diagram-chooser";
const CHOICE = "dzoukr-diagram-choice";

/** The kind of a drawing kept plain Excalidraw, which none of the plugins takes. */
export const PLAIN = "excalidraw";

function button(kind: string, label: string, title: string, onClick: () => void): HTMLButtonElement {
  const b = createEl("button", { cls: CHOICE, text: label, attr: { "data-kind": kind, "aria-label": title } });
  // Keep focus on the canvas.
  b.addEventListener("mousedown", (e) => e.preventDefault());
  b.addEventListener("click", (e) => {
    e.preventDefault();
    onClick();
  });
  return b;
}

const choice = (row: HTMLElement, kind: string) => row.querySelector<HTMLElement>(`:scope > .${CHOICE}[data-kind="${kind}"]`);

/**
 * Offers to take the drawing over: this plugin's button in the shared row, made once, and the choice of plain
 * Excalidraw after all of them, which `keepPlain` makes.
 */
export function offer(host: HTMLElement, kind: string, label: string, title: string, onClick: () => void, keepPlain: () => void) {
  let row = host.querySelector<HTMLElement>(`:scope > .${ROW}`);
  if (!row) {
    row = host.createDiv({ cls: ROW });
    row.createSpan({ cls: `${ROW}-label`, text: "Use this drawing for" });
  }
  let plain = choice(row, PLAIN);
  if (!plain) {
    plain = row.appendChild(button(PLAIN, "Excalidraw", "Keep this drawing plain Excalidraw", keepPlain));
    plain.dataset.owner = kind;
  }
  if (choice(row, kind)) return;
  const after = Array.from(row.querySelectorAll<HTMLElement>(`:scope > .${CHOICE}`)).find((c) => c === plain || (c.dataset.kind ?? "") > kind);
  row.insertBefore(button(kind, label, title, onClick), after ?? null);
}

/** Takes this plugin's buttons out of the shared row, and the row away when no plugin's is left. */
export function withdraw(host: HTMLElement, kind: string) {
  const row = host.querySelector<HTMLElement>(`:scope > .${ROW}`);
  if (!row) return;
  choice(row, kind)?.remove();
  const plain = choice(row, PLAIN);
  if (plain?.dataset.owner === kind) plain.remove();
  if (!row.querySelector(`:scope > .${CHOICE}:not([data-kind="${PLAIN}"])`)) row.remove();
}
