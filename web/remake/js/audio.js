// PC-speaker tunes (docs/modern/assets/tunes.json): one square-wave voice, tick = 1/120 s.
// play(id) starts only when nothing is playing (the original's f_6d79 family); force(id) interrupts (f_6db1).
const TICK = 1 / 120;
let tunes = new Map(), ac = null, osc = null, gain = null, busyUntil = 0;
let enabled = true, volume = 0.5;

export async function loadTunes(url) {
  const j = await (await fetch(url)).json();
  for (const tn of j.psi5) tunes.set(parseInt(tn.id, 16), tn.notes);
}
export function setSound(on, vol) { enabled = on; if (vol !== undefined) volume = vol; if (!on) stop(); }
// browsers need a user gesture before audio: call from any tap/click
export function unlock() {
  if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
  try {
    ac = new AudioContext(); osc = ac.createOscillator(); gain = ac.createGain();
    osc.type = 'square'; gain.gain.value = 0; osc.connect(gain).connect(ac.destination); osc.start();
  } catch { ac = null; }
}
function stop() {
  if (!ac) return;
  gain.gain.cancelScheduledValues(ac.currentTime); gain.gain.setValueAtTime(0, ac.currentTime);
  osc.frequency.cancelScheduledValues(ac.currentTime); busyUntil = 0;
}
function schedule(id) {
  const notes = tunes.get(id);
  if (!notes || !ac || !enabled) return;
  stop();
  const level = 0.06 * volume;
  let at = ac.currentTime + 0.02;
  for (const n of notes) {
    if (n.hz > 0 && n.soundTicks > 0) {
      osc.frequency.setValueAtTime(n.hz, at);
      gain.gain.setValueAtTime(level, at);
      gain.gain.setValueAtTime(0, at + n.soundTicks * TICK);
    }
    at += n.ticks * TICK;
  }
  busyUntil = at;
}
export function play(id) { if (ac && ac.currentTime >= busyUntil) schedule(id); }
export function force(id) { schedule(id); }
