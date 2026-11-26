// The fixed dev / held-out split shared by the loop's sets: FNV-1a of an id, a third held out.

/** FNV-1a, so the split is fixed by each id. */
export function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}
export const splitOf = (id: string) => (fnv1a(id) % 3 === 0 ? "held-out" : "dev");
