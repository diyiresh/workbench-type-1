"use strict";
const SIZE = { width: 100, height: 104 };
function fitPosition(position, areas, size = SIZE) {
  const fallback = areas[0];
  const valid = Number.isFinite(position?.x) && Number.isFinite(position?.y);
  const point = valid ? position : { x: fallback.x + fallback.width - size.width - 24, y: fallback.y + fallback.height - size.height - 24 };
  const distance = a => Math.max(a.x-point.x,0,point.x-(a.x+a.width))**2 + Math.max(a.y-point.y,0,point.y-(a.y+a.height))**2;
  const area = areas.reduce((best,a) => distance(a)<distance(best)?a:best,fallback);
  return { x: Math.round(Math.max(area.x,Math.min(point.x,area.x+area.width-size.width))), y: Math.round(Math.max(area.y,Math.min(point.y,area.y+area.height-size.height))) };
}
module.exports = { SIZE, fitPosition };
