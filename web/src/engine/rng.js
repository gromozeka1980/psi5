// The game's only random source (@7086): 256 Johnson-counter bytes stepped round-robin; returns 0..255.
// Period 4096 calls. Kept exactly so the engine can reproduce the original; call order matters.
export const RNG_FIELDS = [['rngIdx', 0x461a, 'u16'], ['rngTab', 0x461c, 'u8', 256]];
export function random(S) {
  S.rngIdx = (S.rngIdx - 1) & 0xffff;
  const i = S.rngIdx & 0xff, b = S.rngTab[i];
  const v = ((b << 1) | (b >= 0x80 ? 0 : 1)) & 0xff;
  S.rngTab[i] = v;
  return v;
}
