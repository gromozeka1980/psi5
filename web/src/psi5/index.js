// PSI5.EXE port: loads all modules (each registers its functions in F) and exposes the program to rt.load().
import { F } from './fn.js';
import './a_ui.js';
import './b_weapons.js';
import './c_scan.js';
import './d_nav.js';
import './e_eng.js';
import './f_repair.js';
import './g_core.js';
import './h1_anim.js';
import './h2_lowlevel.js';
export { F };
export function* main() { return yield* F.f_0082(); }
export const isrs = { 0x6ca9: () => F.f_6ca9() };
