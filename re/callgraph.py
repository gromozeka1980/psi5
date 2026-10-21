# Call graph of the game code (main..start of C runtime). Prints per function: size, callees, and whether it can
# reach an idle point (keyboard poll / BIOS tick wait) -> must be a generator in the port.
import re, sys, json, collections
exe = sys.argv[1]; lst = open(exe.split('.')[0].lower() + '.lst').read()
END = {'PSI5.EXE': 0x7307, 'SEL.EXE': 0x1289}[exe.upper()]
IDLE = {'PSI5.EXE': {'f_5a79', 'f_5baa', 'f_0748', 'f_076d'}, 'SEL.EXE': {'f_0f48', 'f_0f98', 'f_1011'}}[exe.upper()]
PTR = {'PSI5.EXE': ['f_0d87', 'f_1402', 'f_217d', 'f_2c51', 'f_36f2', 'f_412f', 'f_1443', 'f_2277', 'f_2ca6', 'f_3772', 'f_4230'], 'SEL.EXE': []}[exe.upper()]
funcs = collections.OrderedDict(); cur = None
for l in lst.split('\n'):
    m = re.match(r';==== (\S+)', l)
    if m: cur = m.group(1); funcs[cur] = {'calls': set(), 'n': 0, 'ptr': False}; continue
    if cur and re.match(r'  [0-9a-f]{4}  ', l):
        funcs[cur]['n'] += 1
        m = re.search(r'call   (f_[0-9a-f]+)', l)
        if m: funcs[cur]['calls'].add(m.group(1))
        if re.search(r'call   word ptr \[0x2d0\]', l): funcs[cur]['ptr'] = True
game = {f: v for f, v in funcs.items() if f.startswith('f_') and 0x82 <= int(f[2:], 16) < END}
for f, v in game.items():
    if v['ptr']: v['calls'] |= set(PTR)
gen = set(IDLE)
changed = True
while changed:
    changed = False
    for f, v in game.items():
        if f not in gen and v['calls'] & gen: gen.add(f); changed = True
if '-json' in sys.argv:
    json.dump({f: {'n': v['n'], 'calls': sorted(v['calls']), 'gen': f in gen} for f, v in game.items()}, sys.stdout, indent=0)
else:
    for f, v in game.items(): print(f, v['n'], 'GEN' if f in gen else '   ', ' '.join(sorted(v['calls'])))
    print(len(game), 'funcs', sum(v['n'] for v in game.values()), 'insns;', len(gen), 'generators', file=sys.stderr)
