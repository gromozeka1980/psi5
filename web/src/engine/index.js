// Engine registry. Each subsystem module exports CHECKS: the original function it replaces, the state it owns
// (FIELDS, compared after the step), the read-only data it needs (DATA), and run(S, D, ctx).
// tools/equiv.mjs replays every call of those functions from a running 1:1 port through the engine.
import { MSG_FIELDS } from './messages.js';
import { RNG_FIELDS } from './rng.js';
export const COMMON_FIELDS = [...RNG_FIELDS, ...MSG_FIELDS, ['deptAlive', 0x4ce8, 'i16', 5], ['deptStress', 0x4cf2, 'i16', 5]];
const modules = await Promise.all(['damage', 'scanning', 'nav', 'power', 'combat']
  .map(m => import(`./${m}.js`).catch(e => { if (e.code === 'ERR_MODULE_NOT_FOUND' || /Cannot find module|Failed to fetch/.test(e.message)) return {}; throw e; })));
export const CHECKS = modules.flatMap(m => m.CHECKS || []);
