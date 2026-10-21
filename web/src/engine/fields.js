// Engine state <-> original memory map. Each subsystem declares its state as named fields at the DS offsets the original
// uses; `extract` builds a plain state object from a DS image, `inject` writes one back. The engine itself only works on
// the plain objects; the map exists so the engine can be checked against the 1:1 port (tools/equiv.mjs) and started
// from any original state.
//   field spec: [name, addr, type, count]   type: i16 | u16 | i8 | u8 ; count > 1 makes an array (stride = type size)
const SIZE = { i16: 2, u16: 2, i8: 1, u8: 1 };
function read(ds, a, t) {
  a &= 0xffff;
  switch (t) {
    case 'u8': return ds[a];
    case 'i8': return (ds[a] << 24) >> 24;
    case 'u16': return ds[a] | (ds[(a + 1) & 0xffff] << 8);
    case 'i16': return ((ds[a] | (ds[(a + 1) & 0xffff] << 8)) << 16) >> 16;
  }
  throw new Error('bad type ' + t);
}
function write(ds, a, t, v) { a &= 0xffff; ds[a] = v; if (SIZE[t] === 2) ds[(a + 1) & 0xffff] = v >> 8; }
export function extract(spec, ds) {
  const o = {};
  for (const [name, addr, t, n = 1] of spec)
    o[name] = n === 1 ? read(ds, addr, t) : Array.from({ length: n }, (_, i) => read(ds, addr + i * SIZE[t], t));
  return o;
}
export function inject(spec, o, ds) {
  for (const [name, addr, t, n = 1] of spec) {
    if (n === 1) write(ds, addr, t, o[name]);
    else for (let i = 0; i < n; i++) write(ds, addr + i * SIZE[t], t, o[name][i]);
  }
}
// field-by-field differences between two state objects of the same spec
export function diff(spec, a, b, max = 20) {
  const out = [];
  for (const [name, , , n = 1] of spec) {
    if (n === 1) { if (a[name] !== b[name]) out.push(`${name}: ${a[name]} vs ${b[name]}`); }
    else for (let i = 0; i < n; i++) if (a[name][i] !== b[name][i]) out.push(`${name}[${i}]: ${a[name][i]} vs ${b[name][i]}`);
    if (out.length >= max) break;
  }
  return out;
}
// 16-bit helpers for rules that depend on the original integer width
export const i16 = v => (v << 16) >> 16;
export const u16 = v => v & 0xffff;
