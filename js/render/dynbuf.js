// Partial uploads for per-frame instance buffers. A plain `needsUpdate = true` sends the whole attribute, sized for
// the worst case (1100 particles, 28 soldiers), every frame; most frames use a small fraction of it. Marking only the
// used prefix cut the bytes handed to the driver from about 180 KB to about 30 KB a frame in a busy match.
//
// three's addUpdateRange pushes a fresh {start, count} object and clears the list after each upload, which is a
// small allocation per attribute per frame. Instead each attribute owns one range for life: its clearUpdateRanges is
// made a no-op, so the list always holds exactly that range, and only its count changes.
function ownRange(attr) {
  let r = attr._usedRange;
  if (!r) {
    r = attr._usedRange = { start: 0, count: 0 };
    attr.updateRanges.length = 0;
    attr.updateRanges.push(r);
    attr.clearUpdateRanges = keepRange;
  }
  return r;
}
function keepRange() {}

// Uploads items [0, n) of `attr` on the next render. n = 0 uploads nothing: whatever is past the draw count is unused.
export function uploadUsed(attr, n) {
  if (n <= 0) return;
  const r = ownRange(attr);
  // Callers mark once per frame, after the last write: every batch repacks from index 0 each frame.
  r.count = Math.min(n, attr.count) * attr.itemSize;
  attr.needsUpdate = true;
}
