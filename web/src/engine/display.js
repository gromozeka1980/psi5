// The original advances the combat view (@6e26) whenever it prints text: once per space and once per CR (@5bf8).
// Engine code that shows text calls printed(S, D, ctx, bytes) at the point the original prints it; in "original" mode
// this runs the same number of combat-view ticks (ctx.displayTick), so randomness and combat state stay identical.
// A modern UI can set ctx.decoupleDisplay to drive the combat view from its own clock instead.
export function displayPolls(bytes) {
  let n = 0;
  for (const c of bytes) if (c === 0x20 || c === 0x0d) n++;
  return n;
}
export function printed(S, D, ctx, bytes) {
  if (ctx.decoupleDisplay) { ctx.emit('text', bytes); return; }
  ctx.emit('text', bytes);
  for (let n = displayPolls(bytes); n > 0; n--) ctx.displayTick(S, D);
}
