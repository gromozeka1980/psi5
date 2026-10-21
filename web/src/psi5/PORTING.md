# Porting PSI5.EXE to JS — rules

Goal: a **byte-exact** port. After every idle point the port's memory must equal the original's (verified automatically),
so translate *what the machine code does*, not what it seems to mean. Keep every original quirk and bug.

Inputs: `re/psi5.lst` (full listing; functions start at `;==== f_xxxx ====`, `Lxxxx:` labels, `.table` + `; switch table`
comments for `switch` jump tables, string literals annotated), `re/psi5_cg.json` (call graph: per function `calls`
and `gen` = must be a generator). The SEL.EXE port `web/src/sel.js` is a finished example of the style.
The original is Microsoft C 1.04 (small model, unoptimized) plus hand-written asm helpers (from ~0x5a79 on).

## Module & naming
- Your module `web/src/psi5/<module>.js` registers every function of your range:
  ```js
  import { F, callPtr } from './fn.js';
  import { rb, rw, rs, wb, ww, i16, u16, vput, vget, ... } from '../rt.js';
  // @0786 menuInput(str, items, selPtr): ...one-line description...
  function* f_0786(str, items, selPtr) { ... }
  Object.assign(F, { f_0786, ... });
  ```
- Function names are `f_xxxx` (original address). Put a descriptive name + 1-line summary in a comment above each.
- Call other functions as `F.f_xxxx(...)` (works for functions of any module; unported ones run as original code in the
  test harness). Calling your own module's functions directly is fine too.
- Module header comment: what this part of the game does + a table of the DS globals you figured out
  (`0x3b2 gameOver flag`, ...). These notes will be merged into a symbol table later, so be precise and terse.

## Memory and integers
- `ds` is the original data segment (64 KB, initialised from a snapshot taken at main()). Use the original offsets:
  `rb(a)` byte, `rsb(a)` signed byte, `rw(a)` unsigned word, `rs(a)` signed word, `wb(a,v)`, `ww(a,v)` (store masks).
  Pointers are plain numbers (DS offsets); address arithmetic wraps at 16 bits (`& 0xffff`).
- `int` is 16 bit. Keep JS locals as signed 16-bit numbers: wrap results with `i16()` wherever a 16-bit overflow could
  occur (`x = i16(x + y)`, `i16(a * b)` for `imul` low word). Signed vs unsigned compares follow the jump:
  `jl/jg/jle/jge` signed, `jb/ja/jbe/jae` unsigned → compare `u16(x)`. `idiv` truncates toward zero
  (`Math.trunc`, remainder has the dividend's sign); `div` is unsigned. `sar` = `>>` on the signed value, `shr` = `>>>`
  on the unsigned 16-bit value. `cbw`/`mov al,..; xor ah,ah` = sign-/zero-extension — watch for it.
- Video memory: `vput(off, v)`, `vget(off)` (B800:off; 16 KB, wraps). CGA row start table lives in DS (used by asm).
- Low memory (segment 0 / BIOS data area): `lw/lww`, `low[]`. I/O ports: `inp(port)`, `outp(port, v)`.
- BIOS/DOS: `int10(ax, bx)`; `dosOpen(nameAddr)`, `dosRead(h, addr, n)`, `dosWrite(h, addr, n)`, `dosClose(h)`;
  `exit(code)` (throws). Return values of the DOS calls are what AX would be.

## Calling convention
- cdecl: args pushed right to left; for `push bp; sub sp,N; mov bp,sp` the first arg is `[bp+N+4]`, the second
  `[bp+N+6]`...; for `push bp; mov bp,sp` it is `[bp+4]`. JS parameters in C order. The test harness passes exactly
  `fn.length` arguments, so declare all parameters the function reads (no default values, no rest params).
- Return the value of AX (`return i16(v)`) when **any caller uses it** (check call sites: `call f_x` followed by use of
  ax). If AX is never used by callers, return nothing.
- asm helpers with register arguments are called as `F.f_x(...regs)` in this fixed order:
  `f_5bed(al)`, `f_5f8a(si, di)`, `f_63c5(si)`, `f_66c0(ax, bx, di)`, `f_6b0c(ax)`, `f_6dac(ax)`, `f_6e13(ax)`. If one of your asm
  helpers returns something in a register other than AX, or relies on registers preserved across a call, handle it
  inside your module (callers of these are all in the same module) and document it.
- Code that falls through into the next function or jumps into the middle of another one (e.g. `f_6579` → `f_657f`,
  `f_6dac` → body of `f_6d79`, `f_6868` → `0x6883`): translate as calls of a shared JS helper.
- Indirect call `call word ptr [0x2d0]` → `callPtr(rw(0x2d0))`.

## Locals
- Ordinary locals → JS `let`. If the address of a local is taken (`lea ax,[bp+x]`, or `mov ax,bp; add ax,..`) the
  local must live in memory: `const p = frame(n)` reserves n bytes (returns a DS address), access via rw/ww, and
  `unframe(n)` on every exit path (use try/finally in generators).

## Time: generators and idle points
- Time only passes at *idle points*. Functions with `"gen": true` in `re/psi5_cg.json` are generators (`function*`)
  and every call to a generator is `yield* F.f_x(...)`. Non-generators must not yield.
- Idle points are inside rt.js helpers (`yield* kbhit16()` = INT 16h AH=1, `yield* getkey16()` = INT 16h AH=0,
  `yield* ticks1a()` = INT 1Ah AH=0) and two spin loops on the ISR counter `[0x351c]`: put a bare `yield;`
  **immediately before** the statement that corresponds to the instruction at **0x0754** (in f_0748) and at
  **0x0779** (in f_076d), so that it runs once per loop iteration, before the counter is read.
- The timer ISR (f_6ca9, 120 Hz) is called by the driver at every idle point; never call it yourself.

## setjmp/longjmp (asm in 0x5b50..0x5b97, used by main)
- `f_5b50` (main 0x00a4): stores its return address `0x00a7` to `[0x1cf6]` and sets `[0x1cfe] = 0x898a` (demo key
  script pointer). `f_5b5f` (restart, from f_0463 "same crew"): `f_6c78()`, then sp/bp := `[0x1cf2]`/`[0x1cf4]`
  (both 0) and jump to 0x00a7 in main.
- `f_5b86` (main 0x0176) = setjmp: stores `0x0179`, SP `0xffc8`, BP `0xffc8` to `[0x1cf8]`, `[0x1cfa]`, `[0x1cfc]`.
  `f_5b97` = longjmp back there (after `F.f_5bed(0x20)`). Implement with a thrown token caught in main.
- Write the same values to DS as the original does (they are compared).

## Verifying your work (mandatory)
- `node tools/fcheck.mjs PSI5.EXE f_xxxx [f_yyyy ...]` replays recorded real calls of each non-generator function
  through your port and diffs the full machine state. Every function with recordings must pass. Without arguments it
  checks all ported non-generator functions. Functions without recordings are listed; read them extra carefully.
- Generators are checked by the full-game lockstep: `node tools/diff.mjs <steps>` (steps: `w:N` N idle points,
  `k:<key>` Enter/Esc/Up/Down/Left/Right/Space/Bksp/^X/a char, `r:N:seed` N random keys). SEL runs first (ported);
  e.g. `w:300 k:Enter w:60 k:^D w:7000` = SEL demo mode → PSI5 demo; for manual play into PSI5:
  `w:300 k:Enter w:40 k:Enter w:40 ...` (12 Enters choose a crew), then PSI5 menus. Reports the first differing byte.
- `node --check <file>` for syntax. Do not edit files outside your module (report problems in rt.js/tools instead).
