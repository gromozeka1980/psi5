# Recursive-descent lister: python lister.py PSI5.EXE > psi5.lst ; also writes <exe>_funcs.json
import sys, json, capstone, re
from mz import MZ
exe = sys.argv[1]; m = MZ(exe); code = m.code
md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_16); md.detail = False
funcs = {0x0e: 'start'}; todo = [0x0e]; seen = {}; labels = set(); jtabs = {}
# extra entry points: functions reached only through pointers (re/seeds.json: {"PSI5.EXE": ["0d87", ...]})
import pathlib
SEEDS = json.loads(pathlib.Path(__file__).with_name('seeds.json').read_text()).get(exe.upper(), [])
for x in SEEDS: a0 = int(x, 16); funcs[a0] = f'f_{a0:04x}'; todo.append(a0)
last_cmp = {}
def imm(op):
    try: return int(op, 16) if op.startswith('0x') else int(op)
    except: return None
JCC = {'je','jne','jb','jae','jbe','ja','jl','jge','jle','jg','js','jns','jo','jno','jp','jnp','jcxz','loop','loope','loopne','jmp','call'}
while todo:
    a = todo.pop()
    while a < len(code) and a not in seen:
        ins = next(md.disasm(code[a:a + 16], a), None)
        if ins is None: break
        seen[a] = ins
        mn, op = ins.mnemonic, ins.op_str
        if mn in JCC and imm(op) is not None:
            t = imm(op)
            if mn == 'call':
                if t not in funcs: funcs[t] = f'f_{t:04x}'; todo.append(t)
            else:
                labels.add(t); todo.append(t)
        mc = re.match(r'(\w+), (0x[0-9a-f]+|\d+)$', op)
        if mn == 'cmp' and mc: last_cmp[mc.group(1)] = imm(mc.group(2))
        mj = re.match(r'word ptr cs:\[(\w+) \+ (0x[0-9a-f]+)\]', op)
        if mn == 'jmp' and mj:   # switch: cmp si,N ; jae default ; shl si,1 ; jmp cs:[si+T]
            t, n = int(mj.group(2), 16), last_cmp.get(mj.group(1), 0)
            tgts = [code[t + 2 * i] | code[t + 2 * i + 1] << 8 for i in range(n)]
            jtabs[a] = (t, tgts)
            for x in tgts: labels.add(x); todo.append(x)
            for i in range(2 * n): seen.setdefault(t + i, None)
        if mn in ('ret', 'retf', 'jmp', 'iret') : break
        a += ins.size
# data strings referenced by immediates
def ann(op):
    out = []
    for x in re.findall(r'0x[0-9a-f]+', op):
        v = int(x, 16)
        if 0x20 < v < len(m.data):
            try:
                s = m.cstr(v)
                if 2 <= len(s) < 80 and all(32 <= c < 127 or c in (10, 13) for c in s): out.append(repr(s.decode()))
            except ValueError: pass
    return ' ; ' + ' '.join(out) if out else ''
out = []
prev = None
for a in sorted(seen):
    ins = seen[a]
    if ins is None:
        if a in {t for t, _ in jtabs.values()}: out.append(f'  {a:04x}  .table')
        prev = a + 1; continue
    if a in funcs: out.append(f'\n;==== {funcs[a]} ====')
    elif prev is not None and prev != a: out.append(f'; ---- gap {prev:04x}..{a:04x}')
    if a in labels: out.append(f'L{a:04x}:')
    op = ins.op_str
    if ins.mnemonic == 'call' and imm(op) is not None: op = funcs[imm(op)]
    out.append(f'  {a:04x}  {ins.mnemonic:6s} {op}' + (ann(ins.op_str) if 'push' in ins.mnemonic or 'mov' in ins.mnemonic else ''))
    if a in jtabs: out.append('        ; switch table @%04x: ' + ' '.join(f'{i}:L{x:04x}' for i, x in enumerate(jtabs[a][1])))
    prev = a + ins.size
print('\n'.join(out))
json.dump({f'{k:04x}': v for k, v in sorted(funcs.items())}, open(exe.split('.')[0].lower() + '_funcs.json', 'w'), indent=0)
print(f'; {len(funcs)} funcs, {len(seen)} insns, code {len(code):#x}', file=sys.stderr)
