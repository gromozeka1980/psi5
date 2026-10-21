"""Writes remake_art/jobs.json (one job per slot of docs/remake/ART_SLOTS.json, id = slot id[.variant]) and the
upscaled reference pictures in remake_art/refs/. Style A of the style test (STYLE.md) for every job.
Run: python remake_art/make_jobs.py"""
import glob, json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ART, A = ROOT / 'remake_art', 'docs/modern/assets/'
REFS = ART / 'refs'
REFS.mkdir(exist_ok=True)
slots = {s['id']: s for s in json.loads((ROOT / 'docs/remake/ART_SLOTS.json').read_text(encoding='utf8'))['slots']}
en = json.loads((ROOT / 'web/src/i18n/en.json').read_text(encoding='utf8'))



def ref(src, name, scale):
    """Nearest-neighbour upscale of an original picture (the API reads tiny sprites badly)."""
    im = Image.open(ROOT / src).convert('RGB')
    im.resize((im.width * scale, im.height * scale), Image.NEAREST).save(REFS / name)
    return f'remake_art/refs/{name}'


def biggest(pat):
    return min(glob.glob(str(ROOT / pat)), key=lambda f: -Image.open(f).size[0] * Image.open(f).size[1])


STYLE = ('1980s science-fiction paperback and game-box cover art: airbrushed acrylic painting, smooth gradients, warm amber key '
         'light and orange rim light against deep blue space and cool teal shadows, polished chrome and enamel-painted metal, '
         'glowing CRT screens with soft bloom, subtle film grain, rich saturated but not garish colours, cyan and magenta accent '
         'lights, no text, no lettering, no frame, no border')
TAILS = {
    'portrait': 'Bust portrait, facing the viewer, centred, head and shoulders filling most of the square frame, at the bridge '
                'station shown in the second reference image: softly out-of-focus console with glowing CRT screens behind. '
                'Keep the species, face shape, hair, eyes, markings and clothing colours of the character from the reference '
                'images (the first is the selection portrait, the second shows the same character at the station), but redraw '
                'it as a high-quality painting. Exactly one character, normal anatomy for its species, no extra limbs.',
    'ship': 'A single spaceship in a front three-quarter view, slightly from above, centred, the whole ship visible with generous '
            'margin, on a plain pure black background with no stars, no planet and no glow on the background, so it can be cut '
            'out. Keep the silhouette, proportions and colour layout of the tiny 1986 pixel sprite in the reference image: '
            'teal-painted hull plates, silver-grey highlights, magenta lights where the sprite has magenta pixels.',
    'object': 'Centred on a plain pure black background, nothing else in the picture, so it can be cut out.',
    'wide': 'Wide cinematic composition, no people unless described, no readable text, no lettering, no logo.',
    'tall': 'Portrait-format composition.',
}
jobs = {}


def job(jid, kind, prompt, size='1536x1024', refs=(), **kw):
    slot = jid if jid in slots else jid.rsplit('.', 1)[0]
    assert slot in slots, jid
    jobs[jid] = {'slot': slot, 'kind': kind, 'size': size, 'refFiles': list(refs), 'prompt': prompt, **kw}
    if slot != jid: jobs[jid]['variant'] = jid.rsplit('.', 1)[1]


# ---- crew: 30 candidates (description from the 1986 sprites; species/age/role from the resumes) ----
CANDIDATES = [['boris', 'q6d', 'yeela', 'alzott', 'skulard', 'grolo'], ['jaru', 'phyzo', 'blustan', 'nargo', 'churglk', 'mike'],
              ['klg', 'tegra', 'nik', 'bronx', 'aymu', 'yenx'], ['craven', 'wilfo', 'tony', 'fligrnk', 'sheema', 'vx4'],
              ['anxy', 't3', 'vofgank', 'ryblo', 'bru', 'swigltz']]
ROLE = ['weapons officer', 'scanning officer', 'navigation officer', 'engineering officer', 'repair officer']
LOOK = {
    'boris': 'pale grey humanoid skin, a bristling crest of spiky cyan hair, large round staring eyes under heavy angry brows, long narrow face, tight-lipped; teal military jacket with wide lapels over a magenta shirt',
    'q6d': 'a combat robot: a tall domed helmet head with vertical cyan and silver stripes, a wide black visor band with small slots across the eyes, chunky silver-grey shoulder armour, one magenta-gloved robot hand',
    'yeela': 'a hulking shaggy alien completely covered in long draping fur in magenta, silver-grey and teal streaks, two big round goggle-like eyes on top of the fur mound, a long segmented trunk hanging down the middle of the face, no visible mouth',
    'alzott': 'human-looking, neat short black hair, thick black rectangular glasses, square jaw, confident; teal jacket over a magenta shirt',
    'skulard': 'round broad pale-grey face with a wide friendly grin, round eyes with cyan eyelids, short teal cap of hair; teal tunic with a magenta collar',
    'grolo': 'a young koala-like alien: round fuzzy pale-grey head, big round ears with teal insides, small magenta nose, little round glasses, magenta shirt',
    'jaru': 'slender teal-skinned alien with a tall cage-like dome of vertical magenta hair strands, a long thin ribbed silver neck, calm narrow eyes; magenta gown with a wide silver collar',
    'phyzo': 'tall bald elongated pale-grey head, narrow slit eyes, a small teal fin behind the ear, thin lips; high-collared magenta coat with a teal collar',
    'blustan': 'a reptile alien: teal scaly skin, a flat wedge-shaped head, huge round goggle eyes, magenta blush-coloured cheek scales, wide lipless mouth; magenta robe with a teal clasp',
    'nargo': 'a young girl of 16 with pale-grey skin, a round face and big eyes, voluminous magenta helmet-shaped hair with a checked pattern on top, small magenta lips; magenta and silver striped top',
    'churglk': 'very old alien with a long teal face, narrow tired eyes, magenta lips, a spiky crown of magenta hair and long magenta hair strands falling past the shoulders; teal and magenta checked knitted sweater',
    'mike': 'human-looking young man with swept silver-grey hair, square magenta-tinted glasses, a thin smile; teal sweater',
    'klg': 'a small spindly robot whose head is a cluster of four round camera-lens pods on short stalks, a thin silver body with teal cables draped over it',
    'tegra': 'a young woman with smooth pale-grey skin, a softly painted natural face with big dark eyes and a small nose (painted smoothly, no pixel blocks), wearing a magenta checked knitted hood that also covers her mouth and chin like a scarf, silver-grey tunic',
    'nik': 'teal-skinned humanoid with slicked-back black hair, a silver headset over the ears, rectangular glasses, square jaw; quilted silver-grey padded vest',
    'bronx': 'an old bald alien with pale-grey wrinkled skin, round magenta-tinted spectacles, a small magenta spot marking on one cheek; teal shirt with a black chain necklace',
    'aymu': 'a short humanoid with pale-grey skin and a thick mop of black hair falling over the forehead; his nose is ordinary in shape but its tip is coloured magenta, a natural Jamico skin marking (flat pigment, not a ball, not a clown nose); calm, slightly smug half-smile; dark uniform',
    'yenx': 'a magenta octopus-like alien: a bulbous speckled magenta head, one large heavy-lidded eye, a thick trunk-like tentacle curling down from the face, smooth magenta body',
    'craven': 'human-looking man with a teal cap, glasses, a long straight nose and a dry smile; magenta ribbed turtleneck sweater',
    'wilfo': 'a small round-headed teal alien with two thin antennae ending in silver balls, wide band-shaped silver goggles over the eyes, a tiny mouth; magenta scarf-like top',
    'tony': 'bald pale-grey head with a small teal tuft of hair on top, smooth painted magenta make-up rings around both eyes (soft airbrushed, no pixel blocks), a big friendly smile; magenta sweater with a soft knitted diamond pattern',
    'fligrnk': 'very old thin teal-skinned alien, bald domed head with a deeply wrinkled forehead, round glasses, a long face; teal and black horizontally striped shirt',
    'sheema': 'a young woman with pale-grey skin, long straight magenta hair with a dotted silver headband, teal-rimmed glasses; teal top',
    'vx4': 'a brand-new boxy robot: a squarish silver head with a teal side panel, two tall rectangular eye panels, a face of vertical slats, a ribbed silver neck, magenta chest plate',
    'anxy': 'human-looking man with short black hair, a broad face, magenta-rimmed glasses and a wide grin; teal sweater',
    't3': 'a repair robot: a round silver head with a horizontal-slat face grille and round ear discs, a silver body with teal panels, one claw arm',
    'vofgank': 'human-looking man with dark wavy hair, glasses, a small moustache, a serious face; teal turtleneck sweater',
    'ryblo': 'pale-grey humanoid with a long pointed nose, glasses and a teal baseball cap worn forward; silver-grey work shirt with teal trim, a small repair tool in hand',
    'bru': 'pale-grey humanoid with a silver-grey bob haircut with straight bangs, big black glasses, a small magenta nose tip; teal sweater',
    'swigltz': 'a goat-like alien with pale-grey skin, wavy horn-like hair tendrils sticking out on both sides of the head, round eyes with teal eyelids, two buck teeth; teal ribbed shirt',
}
SEL = sorted(glob.glob(str(ROOT / A / 'sel/portrait_*.png')))
for d, ids in enumerate(CANDIDATES):
    for k, who in enumerate(ids):
        n = d * 6 + k
        sel = Path(SEL[n]).relative_to(ROOT).as_posix()
        refs = [ref(sel, f'sel_{who}.png', 8), ref(f'{A}crew/{who.upper()}_face.png', f'face_{who}.png', 8)]
        name, age, species = (en.get(f'resume.{who}.{f}', '') for f in ('name', 'age', 'species'))
        traits = en.get(f'resume.{who}.strengths', '')
        job(f'portrait.{who}', 'portrait', f'{name}, {species or "Vaccdroid"}, age {age}, {ROLE[d]} of a 1980s space cargo freighter. '
            f'Appearance: {LOOK[who]}. Personality: {traits}', '1024x1024', refs, original=sel)
        jobs[f'portrait.{who}']['who'] = who

# stressed = edit of the picked calm portrait (refFiles filled in by `stressed` below once the calm one is picked)
STRESSED = ('Edit the attached portrait: the same character in the same pose and framing, now under combat stress: beads of '
            'sweat on the skin (none on robot parts, which instead show sparks and a flickering cracked visor), tense brow, '
            'wide alert eyes, clenched jaw, and a red alarm light washing over the scene from one side, the CRT screens behind '
            'flashing red. Keep the face, species, colours, clothing and painting style exactly the same. No text.')
for who in [w for ids in CANDIDATES for w in ids]:
    job(f'portrait.{who}.stressed', 'portrait', STRESSED, '1024x1024', [], raw=True, needs=f'portrait.{who}')

# ---- ships: each prompt written from its own sprite ----
SHIP = {
    1: 'a wide, low flying wing whose two long wings slope down and out to sharp tips like a gull seen from the front, a small raised central cockpit dome with silver window highlights, two magenta lights under the centre',
    2: 'an oval central hull with a silver-windowed canopy, held inside two huge curved pincer arms that form a diamond-shaped claw frame to the left and right, magenta lights at the claw joints and under the hull',
    3: 'two tall flat rectangular wing panels on the left and right, joined by horizontal struts to a compact central oval pod, a magenta light under the pod, silver highlights on the struts',
    4: 'a layered flying saucer: a rounded upper dome with a magenta light, a wide flat rim, a lower skirt and a slim keel spike underneath ending in a magenta light',
    5: 'a compact beetle-like central body with two magenta eye lights and silver highlights, two long thin arms angled up and out like raised antennae with magenta tips, and a flat oval base plate underneath',
    6: 'a central body with two magenta eye lights, wings bent into a wide W shape rising to magenta-tipped points, and a broad flat underside with two magenta lights',
    7: 'a flat broad bat-wing with straight leading edges, a small pointed central body with a glowing magenta core and two short horn-like antennae on top',
    8: 'an arched half-ring hull like a horseshoe standing on its open end, a silver window strip along the arch, magenta lights on both sides, and three splayed landing legs underneath',
    9: 'a heavier armoured cousin of an arched horseshoe-shaped lander: a thick arched hull with a silver window strip, extra engine pods on both sides, magenta lights, and three splayed landing legs',
}
for c, look in SHIP.items():
    src = biggest(f'{A}psi5/ship_t{min(c, 8)}_*.png')
    rel = Path(src).relative_to(ROOT).as_posix()
    job(f'ship.class{c}', 'ship', f'A small hostile alien starship, redrawn from the attached pixel sprite: {look}.', '1536x1024',
        [ref(rel, f'ship_t{c}.png', 16)], original=rel, margin=0.03)

SHOT = {'missile': 'a sonic missile: a glowing magenta energy projectile shaped like two facing chevrons with a white-hot silver core, short light trail',
        'blaster': 'a blaster bolt: a compact square-ish glowing magenta plasma block with a cyan-white hot corner, short streak',
        'cannon': 'a cannon shell: a glowing magenta energy ring with silver highlights, like a pair of brackets around a bright core',
        'thermo': 'a thermo charge: a swirling magenta and orange fireball shaped like a curled double arrow, intense white-hot centre'}
for k, look in SHOT.items():
    src = Path(biggest(f'{A}psi5/shot_{k}_*.png')).relative_to(ROOT).as_posix()
    job(f'shot.{k}', 'object', f'A single weapon projectile seen almost head-on, flying towards the viewer, redrawn from the attached pixel sprite: {look}, with a soft glow.',
        '1536x1024', [ref(src, f'shot_{k}.png', 16)], original=src, cut='glow', margin=0.02)
job('fx.explosion', 'object', 'A single spaceship explosion seen head-on: a round burst of white-hot fire, amber and orange flame, flying silver-grey debris fragments and sparks, with a soft glowing smoke ring.',
    '1024x1024', [ref(f'{A}psi5/explosion_5.png', 'explosion.png', 16)], original=f'{A}psi5/explosion_5.png', cut='glow')

# ---- backgrounds, scenes, maps ----
PLANETS = ['Renlozen, a warm ochre and rust desert world with pale clouds', 'Kozzar-7, a cold blue-white ice world with glowing cyan cracks',
           'Zipo-Aga, a lush green and teal jungle world with swirling storms', 'Splyteux, a violet and magenta gas giant with bright rings']
CARGO = ['Frybluts', 'Nucliarc', 'Grananas', 'Prebliks']
FREIGHTER = 'the PSI-5, a stubby cargo freighter with a domed saucer section and a long silver hull with engine pods, like the one in the attached 1986 pixel picture'
arr = ref(f'{A}psi5/arrival.png', 'arrival.png', 8)
job('bg.title', 'wide', f'Key art for the game: {FREIGHTER}, pulling away from Starbase 27, a huge ring-shaped space station with docking lights, above the glowing violet and blue Xaldur nebula and the curve of a magenta planet. Three small angular pirate raiders with glowing eye-lights approach in the far distance. Keep the upper third calmer so a title logo can sit there.',
    '1536x1024', [arr], quality='high', original=f'{A}psi5/arrival.png')
job('bg.select', 'wide', 'A glowing holographic star chart of the Parvin Frontier projected on a large dark CRT map table aboard a starbase: amber grid lines, dotted route lines between a few star systems, small planet markers, chrome table edges, the dim control room around it. No readable text.', '1536x1024')
for i, p in enumerate(PLANETS):
    job(f'map.course.{i}', 'wide', f'The destination planet {p}, seen from orbit and filling the right half of the picture; a thin glowing amber dotted route line arcs in from the left towards it, starting at a tiny bright starbase. Deep blue space with stars. No spaceships anywhere in the picture.', '1536x1024')
    job(f'scene.arrival.{i}', 'wide', f'Arrival: {FREIGHTER}, entering orbit above {p}, which fills the lower part of the picture. Deep space with stars.',
        '1536x1024', [arr], original=f'{A}psi5/arrival.png')
job('scene.departure', 'wide', 'View through the curved bridge window of a cargo freighter: huge mechanical docking clamps swing open, the lit hull and windows of Starbase 27 recede, warning lamps blink amber, open space beyond.', '1536x1024')
job('scene.aborted', 'wide', f'Mission aborted: {FREIGHTER}, badly damaged, limping back through space, trailing smoke and sparks from a torn engine pod and scorched hull plates, a red alarm light glow over the whole scene.', '1536x1024', [arr], original=f'{A}psi5/arrival.png')
job('view.space.fore', 'wide', 'Pure deep space, full frame: a soft blue and violet nebula, faint distant stars, a lot of calm dark space in the middle. No cockpit, no window frame, no console, no ships, no planets. Nothing else.', '1536x1024')
job('view.space.aft', 'wide', 'Pure deep space, full frame: a receding blue and violet nebula, faint distant stars, calm dark space in the middle, and only a soft warm amber light glow rising from the very bottom edge as if from engines out of view. No ship, no hull, no engines visible, no cockpit, no window frame. Nothing else.', '1536x1024')
job('briefing.admiral', 'tall', 'Admiral Lorenzen, a grey-haired stern but kind fleet admiral in a dark blue uniform with gold braid, seated at his large desk at Starbase 27 command, a window onto space and docked ships behind him. At the top of the picture a printed letterhead band reading exactly "STAR BASE 27 COMMAND" in bold retro chrome letters, no other text.',
    '1024x1536', raw=False, focus=0.0)
job('ui.invoice', 'tall', 'A flat scan of a sheet of 1980s continuous-feed computer printer paper, seen exactly straight on and filling the entire picture edge to edge (no desk, no background, no shadow around it): pale cream paper with faint pale-green horizontal bar stripes, a column of round tractor-feed holes along the left and right edges with perforation lines. At the top a printed letterhead in dark blue ink with a small round Psi emblem and the words exactly "PSI 5 TRADING COMPANY"; everything below the letterhead is blank paper (no other text, no numbers). Slight warm airbrushed paper texture.',
    '1024x1536', focus=0.0)

# ---- UI ----
job('logo', 'object', 'The title logo of a 1986 space trading game: the words exactly "PSI 5 TRADING COMPANY" on one line, in heavy bevelled chrome airbrushed letters with a magenta and cyan edge glow, a single star-burst lens flare on one letter. Exactly that text, correctly spelled, nothing else.',
    '1536x1024', quality='high', margin=0.01)
DEPT_ICON = {'weapons': 'a crossed cannon barrel and missile', 'scanning': 'a radar dish with sweeping beam rings', 'navigation': 'a compass star over a curved orbit line',
             'engineering': 'a reactor atom symbol with a lightning bolt', 'repair': 'a crossed wrench and screwdriver'}
FACE_OF = {'weapons': 'boris', 'scanning': 'jaru', 'navigation': 'klg', 'engineering': 'craven', 'repair': 'anxy'}
for d, look in DEPT_ICON.items():
    job(f'dept.icon.{d}', 'object', f'A round enamel badge emblem for the {d} department of a 1980s starship crew: {look}, in teal, magenta and amber enamel with a polished chrome rim. Simple bold shapes readable at 40 pixels, no text, no letters.', '1024x1024', margin=0.02)
    job(f'station.{d}', 'wide', f'The {d} console of a 1980s starship bridge, without any person: CRT screens with glowing graphics, rows of toggle switches and lamps, warm amber panel light, laid out like the console behind the crew member in the attached 1986 pixel picture. A wide low strip of console, seen from the operator seat.',
        '1536x1024', [ref(f'{A}crew/{FACE_OF[d].upper()}_face.png', f'station_{d}.png', 8)], focus=0.55)
job('ui.bezel', 'object', 'A square picture frame for a computer panel, seen straight on: thick brushed beige plastic of a 1980s computer monitor bezel with rounded inner corners and a small chrome screw in each corner; the frame border is about one sixth of the width on every side and the inside of the frame is an empty pure black hole. Symmetrical.',
    '1024x1024', cut='frame')

json.dump({'style': STYLE, 'tails': TAILS, 'jobs': jobs}, open(ART / 'jobs.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
missing = [s for s in slots if s not in jobs]
print(len(jobs), 'jobs;', 'slots without a job:', missing)
