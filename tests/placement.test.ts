import test from "node:test";
import assert from "node:assert/strict";
import { placeMenu } from "../src/shared/placement";

const screen = { x: 0, y: 25, width: 1440, height: 875 }; // below a 25 pt menu bar
const size = { width: 360, height: 300 };

test("menu opens just below the caret when there is room", () => {
  const caret = { x: 400, y: 200, width: 1, height: 18 };
  assert.deepEqual(placeMenu(caret, size, screen), {
    x: 386,
    y: 224,
    side: "below",
  });
});
test("a chat box at the bottom of the screen gets the menu above it", () => {
  const field = { x: 300, y: 820, width: 700, height: 40 };
  const placed = placeMenu(field, size, screen);
  assert.equal(placed.side, "above");
  assert.equal(placed.y, 820 - 6 - 300);
});
test("menu stays fully on screen at the right edge and on secondary displays", () => {
  const caret = { x: 1435, y: 100, width: 1, height: 18 };
  assert.equal(placeMenu(caret, size, screen).x, 1440 - 8 - 360);
  const left = { x: -1920, y: 0, width: 1920, height: 1080 };
  const placed = placeMenu({ x: -1915, y: 40, width: 1, height: 18 }, size, left);
  assert.equal(placed.x, -1912);
  assert.ok(placed.y >= 8 && placed.y + size.height <= 1080 - 8);
});
test("when neither side fits, the roomier side is used and clamped on screen", () => {
  const tall = { width: 360, height: 800 };
  const placed = placeMenu({ x: 200, y: 300, width: 1, height: 18 }, tall, screen);
  assert.equal(placed.side, "below");
  assert.ok(placed.y >= 33 && placed.y + 800 <= 25 + 875 - 8);
});
