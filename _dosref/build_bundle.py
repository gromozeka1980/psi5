# Builds psi5.jsdos (game files only, no GOG/DOSBox extras). Usage: python build_bundle.py [machine] [name] [cycles]
import zipfile, pathlib, sys
here = pathlib.Path(__file__).parent; game = here.parent
machine = sys.argv[1] if len(sys.argv) > 1 else 'svga_s3'
name = sys.argv[2] if len(sys.argv) > 2 else 'psi5'
cycles = sys.argv[3] if len(sys.argv) > 3 else 'auto'
with zipfile.ZipFile(here / f'{name}.jsdos', 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('.jsdos/dosbox.conf', f"[sdl]\nautolock=false\n[dosbox]\nmachine={machine}\nmemsize=16\n[cpu]\ncore=normal\ncycles={cycles}\n[autoexec]\nmount c .\nc:\nPSIBAS.EXE\n")
    for f in game.iterdir():
        if f.suffix.upper() in ('.BIN', '.EXE', '.COM') and not f.name.startswith('unins'): z.write(f, f.name.upper())
