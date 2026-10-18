// Default node styles per depth. Applied when a node is created, layout never restyles existing nodes.

export interface Branch { stroke: string; fill: string; }

export interface NodeStyle {
  fontSize: number;
  textColor: string;
  borderColor: string;
  backgroundColor: string;
  strokeWidth: number;
  padX: number;
  padY: number;
  edgeWidth: number;
}

export interface Colors {
  central: { text: string; border: string; fill: string };
  topicText: string; // text of main topics and subtopics
  branches: Branch[]; // cycled through for the main topics of a map
}

export const DEFAULT_COLORS: Colors = {
  central: { text: "#ffffff", border: "#1e1e1e", fill: "#1e1e1e" },
  topicText: "#1e1e1e",
  branches: [
    { stroke: "#e03131", fill: "#ffc9c9" },
    { stroke: "#1971c2", fill: "#a5d8ff" },
    { stroke: "#2f9e44", fill: "#b2f2bb" },
    { stroke: "#f08c00", fill: "#ffec99" },
    { stroke: "#9c36b5", fill: "#eebefa" },
    { stroke: "#0c8599", fill: "#99e9f2" },
  ],
};

/** Colors from the plugin settings; the plugin replaces them on load and whenever the settings change. */
let colors: Colors = DEFAULT_COLORS;

export function setColors(c: Colors) {
  colors = c;
}

/** Branch colors for the i-th main topic of a map. */
export function branchColor(i: number): Branch {
  const b = colors.branches.length ? colors.branches : DEFAULT_COLORS.branches;
  return b[i % b.length];
}

export const DEFAULT_TEXT = ["Central Topic", "Main Topic", "Subtopic"];
export const MIN_TEXT_WIDTH = 24;

export function paddingFor(depth: number): { padX: number; padY: number } {
  if (depth === 0) return { padX: 24, padY: 14 };
  if (depth === 1) return { padX: 16, padY: 10 };
  return { padX: 12, padY: 6 };
}

export function styleFor(depth: number, branch: Branch): NodeStyle {
  const pad = paddingFor(depth);
  if (depth === 0)
    return { fontSize: 28, textColor: colors.central.text, borderColor: colors.central.border, backgroundColor: colors.central.fill, strokeWidth: 2, edgeWidth: 2, ...pad };
  if (depth === 1)
    return { fontSize: 20, textColor: colors.topicText, borderColor: branch.stroke, backgroundColor: branch.fill, strokeWidth: 2, edgeWidth: 2, ...pad };
  return { fontSize: 16, textColor: colors.topicText, borderColor: branch.stroke, backgroundColor: "transparent", strokeWidth: 1, edgeWidth: 1, ...pad };
}
