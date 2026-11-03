export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Placement {
  x: number;
  y: number;
  side: "below" | "above";
}
/**
 * Position the inline paste menu next to where the user is typing: just below the
 * caret (or focused field) when it fits, otherwise above it, always fully on screen.
 * The menu's left edge sits slightly left of the caret so option text lines up with it.
 */
export function placeMenu(
  anchor: Rect,
  size: { width: number; height: number },
  workArea: Rect,
  gap = 6,
  margin = 8,
): Placement {
  const top = workArea.y + margin;
  const bottom = workArea.y + workArea.height - margin;
  const below = anchor.y + anchor.height + gap;
  const above = anchor.y - gap - size.height;
  let side: Placement["side"];
  let y: number;
  if (below + size.height <= bottom) [side, y] = ["below", below];
  else if (above >= top) [side, y] = ["above", above];
  else {
    // Neither side fits fully: use the roomier side and clamp on screen.
    side = bottom - below >= anchor.y - top ? "below" : "above";
    y = side === "below" ? below : above;
  }
  y = Math.min(Math.max(y, top), bottom - size.height);
  const left = workArea.x + margin;
  const right = workArea.x + workArea.width - margin - size.width;
  const x = Math.min(Math.max(anchor.x - 14, left), Math.max(left, right));
  return { x: Math.round(x), y: Math.round(y), side };
}
