// Function namespace of the PSI5.EXE port. Every module registers its functions here under their original address
// (F.f_0786 = function at CS:0786), and calls other modules' functions through F. See PORTING.md.
export const F = {};
// call through a function pointer stored in DS (e.g. `call word ptr [0x2d0]`); all pointer targets are plain functions
export const callPtr = addr => F['f_' + addr.toString(16).padStart(4, '0')]();
