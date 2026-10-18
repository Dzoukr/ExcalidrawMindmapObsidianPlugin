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
  summary: { text: string; border: string; fill: string }; // border also colors the brace
  boundary: { line: string; fill: string; title: string; titleFill: string };
  branches: Branch[]; // cycled through for the main topics of a map
}

export const DEFAULT_COLORS: Colors = {
  central: { text: "#ffffff", border: "#1e1e1e", fill: "#1e1e1e" },
  topicText: "#1e1e1e",
  summary: { text: "#1e1e1e", border: "#1e1e1e", fill: "#ffffff" },
  boundary: { line: "#868e96", fill: "#e9ecef", title: "#1e1e1e", titleFill: "#adb5bd" },
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

/** Whether new connectors end in an arrowhead at the child; also from the plugin settings. */
let arrows = false;

export function setArrows(v: boolean) {
  arrows = v;
}

export const connectorArrowhead = () => (arrows ? "arrow" : null);

/** Branch colors for the i-th main topic of a map. */
export function branchColor(i: number): Branch {
  const b = colors.branches.length ? colors.branches : DEFAULT_COLORS.branches;
  return b[i % b.length];
}

export const DEFAULT_TEXT = ["Central Topic", "Main Topic", "Subtopic"];
export const SUMMARY_TEXT = "Summary";
export const BOUNDARY_TEXT = "Boundary";
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

export const SUMMARY_PADDING = { padX: 16, padY: 8 };
export const TITLE_PADDING = { padX: 12, padY: 4 };
export const TITLE_FONT_SIZE = 16;

export function boundaryColors() {
  return colors.boundary;
}

/** Summary topics use their own colors, whatever the branch. */
export function summaryStyle(): NodeStyle {
  const c = colors.summary;
  return { fontSize: 16, textColor: c.text, borderColor: c.border, backgroundColor: c.fill, strokeWidth: 2, edgeWidth: 2, ...SUMMARY_PADDING };
}
