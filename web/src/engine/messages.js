// Officer message queues (@64be post, @6526 remove): per department up to 8 message ids, newest last, no duplicates;
// a department's lamp is lit while its queue is non-empty. Posting to a department whose officer is dead does nothing.
// `fixes.msgOverflow` repairs the original overflow (which duplicates the oldest message and loses the newest-but-one).
export const MSG_FIELDS = [
  ['msgCount', 0x3212, 'i16', 5],
  ['msgQueue', 0x321c, 'u16', 41],          // 5 departments x 8 entries (+1: removal shifts in the following word)
  ['msgLamp', 0x3294, 'u16', 1],            // lamps: widget[dept]+2 (0x3294, 0x329a, 0x32a0, 0x32a6, 0x32ac)
  ['msgLamp1', 0x329a, 'u16'], ['msgLamp2', 0x32a0, 'u16'], ['msgLamp3', 0x32a6, 'u16'], ['msgLamp4', 0x32ac, 'u16'],
];
const LAMP = ['msgLamp', 'msgLamp1', 'msgLamp2', 'msgLamp3', 'msgLamp4'];
function setLamp(S, d, v) { if (d === 0) S.msgLamp = v; else S[LAMP[d]] = v; }
// id: hi byte = dept*2, lo byte = message index*2 (as in the crew files); negative ids are ignored
export function post(S, id, ctx) {
  if (id & 0x8000) return;
  const d = (id >> 8) >> 1, m = id & 0xff, q = d * 8;
  if (!S.deptAlive[d]) return;
  const n = S.msgCount[d];
  if (n === 0) { setLamp(S, d, 2); ctx?.emit('lamp', d, true); }
  else {
    for (let i = 0; i < n; i++) if (S.msgQueue[q + i] === m) return;
    if (n >= 8) {
      if (ctx?.fixes?.msgOverflow) for (let i = 0; i < 7; i++) S.msgQueue[q + i] = S.msgQueue[q + i + 1];
      else S.msgQueue[q] = S.msgQueue[q + 1];
      S.msgCount[d] = n - 1;
    }
  }
  S.msgQueue[q + S.msgCount[d]] = m;
  S.msgCount[d]++;
}
export function remove(S, id, ctx) {
  if (id & 0x8000) return;
  const d = (id >> 8) >> 1, m = id & 0xff, q = d * 8, n = S.msgCount[d];
  let i = 0;
  for (; i < n; i++) if (S.msgQueue[q + i] === m) break;
  if (i === n) return;
  for (; i < n; i++) S.msgQueue[q + i] = S.msgQueue[q + i + 1];   // shifts in the word after the last entry, like the original
  S.msgCount[d] = n - 1;
  if (S.msgCount[d] === 0) { setLamp(S, d, 0); ctx?.emit('lamp', d, false); }
}
