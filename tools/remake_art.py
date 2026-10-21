"""Generates the remake art with the OpenAI Images API, with a hard spending cap (adapted from Siboot's TB/web/tools/remake_art.py).

  python tools/remake_art.py models                          image models available to the key
  python tools/remake_art.py run 'portrait.*' ship.class1 [--quality medium] [--budget 25]
  python tools/remake_art.py pick ship.class1 remake_art/out/ship.class1/2.png   -> remake_art/picked/ship.class1.png, then export
  python tools/remake_art.py dead portrait.boris ...         portrait.<who>.dead from the picked calm portrait (no API), then export
  python tools/remake_art.py export [ids...]                 remake_art/picked/*.png -> web/remake/art/<id>.webp (+ <id>.s.webp) + manifest
  python tools/remake_art.py sheets                          remake_art/sheets/<group>.png contact sheets
  python tools/remake_art.py spent                           money spent so far (from API usage)

The key is read from OPENAI_API_KEY or from <project>/.env (line OPENAI_API_KEY=sk-...). It is never printed.
Jobs (id = slot id[.variant]): remake_art/jobs.json, written by remake_art/make_jobs.py. Results: remake_art/out/<job>/<k>.png.
Spend log: remake_art/spend.jsonl. Picked files: remake_art/picks.json. Slots: docs/remake/ART_SLOTS.json.
"""
import argparse, base64, json, os, sys, time
from pathlib import Path
import numpy as np
import requests
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[1]          # project root
ART = ROOT / 'remake_art'
PICKED = ART / 'picked'                              # lossless masters at slot size: <slot id>[.<variant>].png
DEST = ROOT / 'web' / 'remake' / 'art'               # what the UI loads: <id>.webp, <id>.s.webp (small) + manifest.json
WEBP_Q, WEBP_ALPHA_Q = 80, 85                        # lossy WebP; transparent slots keep their alpha
API = 'https://api.openai.com/v1'
SLOTS = {s['id']: s for s in json.loads((ROOT / 'docs/remake/ART_SLOTS.json').read_text(encoding='utf8'))['slots']}

# USD per 1M tokens. gpt-image-1 = list price. Models without a known price are charged at twice that
# (deliberately pessimistic) and every such cost is flagged as an estimate.
PRICE = {'gpt-image-1': {'text_in': 5, 'image_in': 10, 'out': 40}}
UNKNOWN = {'text_in': 10, 'image_in': 20, 'out': 80}
OUT_TOKENS = {('1024x1024', 'low'): 272, ('1024x1024', 'medium'): 1056, ('1024x1024', 'high'): 4160,
              ('1536x1024', 'low'): 408, ('1536x1024', 'medium'): 1584, ('1536x1024', 'high'): 6240}


def key():
    k = os.environ.get('OPENAI_API_KEY')
    env = ROOT / '.env'
    if not k and env.exists():
        for line in env.read_text(encoding='utf8').splitlines():
            if line.strip().startswith('OPENAI_API_KEY='): k = line.split('=', 1)[1].strip().strip('"\'')
    if not k: sys.exit('No key: put OPENAI_API_KEY=sk-... into ' + str(env))
    return k


def spend_log():
    """Every API call, one JSON object per line (appends are atomic, so parallel runs never lose an entry)."""
    p = ART / 'spend.jsonl'
    return [json.loads(l) for l in p.read_text().splitlines() if l.strip()] if p.exists() else []


def usd(model, usage):
    p = PRICE.get(model, UNKNOWN)
    d = usage.get('input_tokens_details', {})
    text_in = d.get('text_tokens', usage.get('input_tokens', 0) - d.get('image_tokens', 0))
    return (text_in * p['text_in'] + d.get('image_tokens', 0) * p['image_in'] + usage.get('output_tokens', 0) * p['out']) / 1e6


def post(H, prompt, refs, size, quality, args):
    if refs:
        files = [('image[]', (p.name, p.read_bytes(), 'image/png')) for p in refs]
        return requests.post(f'{API}/images/edits', headers=H, files=files, timeout=600,
                             data={'model': args.model, 'prompt': prompt, 'size': size, 'quality': quality, 'n': args.n})
    return requests.post(f'{API}/images/generations', headers=H, timeout=600,
                         json={'model': args.model, 'prompt': prompt, 'size': size, 'quality': quality, 'n': args.n})


def prompt_of(cfg, job):
    if job.get('raw'): return job['prompt']
    return f"{job['prompt']} {cfg['tails'].get(job['kind'], '')} Style: {cfg['style']}".strip()


def run(args):
    cfg = json.loads((ART / 'jobs.json').read_text(encoding='utf8'))
    H = {'Authorization': 'Bearer ' + key()}
    ids = [j for a in args.jobs for j in ([k for k in cfg['jobs'] if k.startswith(a[:-1])] if a.endswith('*') else [a])]
    for jid in ids:
        job = cfg['jobs'].get(jid) or sys.exit(f'unknown job {jid}; see remake_art/jobs.json')
        size, quality = job.get('size', '1024x1024'), job.get('quality', args.quality)
        spent = sum(e['usd'] for e in spend_log())  # re-read: parallel runs share the cap
        pr = PRICE.get(args.model, UNKNOWN)  # newer models may emit more tokens than gpt-image-1: x2 margin
        estimate = args.n * (OUT_TOKENS[(size.replace('1024x1536', '1536x1024'), quality)] * 2 * pr['out'] + 3000 * pr['image_in']) / 1e6
        if spent + estimate > args.budget:
            sys.exit(f'stop: spent ${spent:.2f}, next job ~${estimate:.2f} would pass the ${args.budget:.2f} cap')
        out = ART / 'out' / jid
        if args.skip_done and any(out.glob('*.png')):
            print(f'{jid}: already generated, skipped'); continue
        refs = [ROOT / f for f in job.get('refFiles', [])]
        for attempt in range(5):  # long requests are sometimes reset by the server
            try: r = post(H, prompt_of(cfg, job), refs, size, quality, args); break
            except requests.exceptions.RequestException as e:
                print(f'{jid}: connection error ({type(e).__name__}), retry {attempt + 1}/5'); time.sleep(15 * (attempt + 1))
        else:
            print(f'{jid}: giving up after 5 connection errors, skipped'); continue
        if r.status_code == 400 and 'moderation_blocked' in r.text:
            print(f'{jid}: blocked by moderation, skipped'); continue
        if r.status_code != 200:
            print(f'{jid}: API error {r.status_code}: {r.text[:300]}'); continue
        res = r.json()
        cost = usd(args.model, res.get('usage', {}))
        with open(ART / 'spend.jsonl', 'a') as f:
            f.write(json.dumps({'job': jid, 'model': args.model, 'quality': quality, 'size': size, 'n': args.n, 'usage': res.get('usage'),
                                'usd': round(cost, 4), 'estimate': args.model not in PRICE, 'at': time.strftime('%Y-%m-%d %H:%M')}) + '\n')
        out.mkdir(parents=True, exist_ok=True)
        k = len(list(out.glob('*.png')))
        for d in res['data']:
            k += 1
            (out / f'{k}.png').write_bytes(base64.b64decode(d['b64_json']))
            print(f'{jid}: {out / f"{k}.png"}')
        print(f'{jid}: ${cost:.3f}{"" if args.model in PRICE else " (estimate)"}, total ${spent + cost:.2f} of ${args.budget:.2f}')


def cutout(im, mode):
    """Alpha for art painted on black. glow: alpha = brightness, colour un-premultiplied (shots, fire).
    solid/frame: everything not reachable from the border (frame: also from the centre) through near-black pixels is
    opaque, so dark hull parts inside stay; plus a soft brightness halo so glows fade out instead of being cut."""
    rgb = np.asarray(im.convert('RGB')).astype(np.float32)
    lum = rgb.max(axis=2)
    if mode == 'glow':
        a = np.clip((lum - 12) * 1.5, 0, 255)
        col = np.clip(rgb * 255 / np.maximum(lum, 1)[..., None], 0, 255)
        return Image.fromarray(np.dstack([col, a]).astype(np.uint8), 'RGBA')
    bg = Image.fromarray(np.where(lum < 26, 255, 0).astype(np.uint8)).copy()  # copy: floodfill can't write numpy-backed images
    w, h = bg.size
    seeds = [(x, y) for x in range(0, w, 8) for y in (0, h - 1)] + [(x, y) for y in range(0, h, 8) for x in (0, w - 1)]
    if mode == 'frame': seeds += [(w // 2 + dx, h // 2 + dy) for dx in (-40, 0, 40) for dy in (-40, 0, 40)]
    for p in seeds:
        if bg.getpixel(p) == 255: ImageDraw.floodfill(bg, p, 128)
    solid = bg.point(lambda v: 0 if v == 128 else 255).filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(1.2))
    halo = np.clip((lum - 26) * 2.0, 0, 255) if mode == 'solid' else np.zeros_like(lum)
    a = np.maximum(np.asarray(solid, np.float32), halo)
    return Image.fromarray(np.dstack([rgb, a]).astype(np.uint8), 'RGBA')


def fit(im, W, H, margin):
    """Transparent art: crop to the visible pixels and centre it in W x H with a margin."""
    im = im.crop(im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox())
    k = min(W * (1 - 2 * margin) / im.width, H * (1 - 2 * margin) / im.height)
    im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    out.paste(im, ((W - im.width) // 2, (H - im.height) // 2), im)
    return out


def cover(im, W, H, focus=0.5):
    """Opaque art: crop to the slot's aspect (focus = vertical position 0..1 of the crop), then resize."""
    if im.width / im.height > W / H:
        w = round(im.height * W / H); left = (im.width - w) // 2
        im = im.crop((left, 0, left + w, im.height))
    else:
        h = round(im.width * H / W); top = round((im.height - h) * focus)
        im = im.crop((0, top, im.width, top + h))
    return im.resize((W, H), Image.LANCZOS)


def explosion_sheet(im, W, H):
    """fx.explosion: 8 square frames in a row, made from one painted burst (grows, then fades) like the original."""
    out = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    for i in range(8):
        s = 0.45 + 0.55 * (i / 7) ** 0.5
        f = fit(im, round(H * s), round(H * s), 0.02)
        fade = 1.0 if i < 4 else 1 - (i - 3) / 5
        f.putalpha(f.getchannel('A').point(lambda v: int(v * fade)))
        out.paste(f, (i * H + (H - f.width) // 2, (H - f.height) // 2), f)
    return out


def small_width(name, W):
    """Width of the phone-size variant <id>.s.webp, 0 = none. Portraits: 320 (cards on phones, console, panel heads);
    everything 512 px or wider: half size; small slots (icons, shots, bezel) have one size."""
    return 320 if name.startswith('portrait.') else W // 2 if W >= 512 else 0


def export(names=None):
    """remake_art/picked/<id>.png -> web/remake/art/<id>.webp (+ <id>.s.webp) and manifest.json
    {id: {w, h, s}} (s = width of the small variant, 0 = none). portrait.<who>.calm is the same picture as
    portrait.<who> and is not exported (the UI uses the base id for calm)."""
    DEST.mkdir(parents=True, exist_ok=True)
    man_p = DEST / 'manifest.json'
    man = json.loads(man_p.read_text()) if man_p.exists() else {}
    if isinstance(man, list): man = {}                                     # old format: list of ids (PNG files)
    for f in sorted(PICKED.glob('*.png')) if not names else [PICKED / f'{n}.png' for n in names]:
        name = f.stem
        if name.endswith('.calm'): continue
        im = Image.open(f)
        im = im if im.mode == 'RGBA' else im.convert('RGB')
        sw = small_width(name, im.width)
        out = [(DEST / f'{name}.webp', im)]
        if sw: out.append((DEST / f'{name}.s.webp', im.resize((sw, round(im.height * sw / im.width)), Image.LANCZOS)))
        for path, v in out: v.save(path, 'WEBP', quality=WEBP_Q, alpha_quality=WEBP_ALPHA_Q, method=6)
        if not sw: (DEST / f'{name}.s.webp').unlink(missing_ok=True)
        man[name] = {'w': im.width, 'h': im.height, 's': sw}
        print('exported', name, ' '.join(f'{p.name} {p.stat().st_size // 1024} KB' for p, _ in out))
    man_p.write_text('{\n' + ',\n'.join(f'{json.dumps(k)}: {json.dumps(v)}' for k, v in sorted(man.items())) + '\n}\n')


def save_art(name, im):
    PICKED.mkdir(parents=True, exist_ok=True)
    im.save(PICKED / f'{name}.png', optimize=True)
    print('saved', PICKED / f'{name}.png')
    export([name])


def pick(args):
    job = json.loads((ART / 'jobs.json').read_text(encoding='utf8'))['jobs'][args.job]
    slot = SLOTS[job['slot']]
    W, H = slot['size']
    im = Image.open(args.file)
    if slot['transparent']:
        im = cutout(im, job.get('cut', 'solid'))
        im = explosion_sheet(im, W, H) if job['slot'] == 'fx.explosion' else \
            im.resize((W, H), Image.LANCZOS) if job.get('cut') == 'frame' else fit(im, W, H, job.get('margin', 0.04))
    else:
        im = cover(im.convert('RGB'), W, H, job.get('focus', 0.5))
    save_art(args.job, im)
    picks = json.loads((ART / 'picks.json').read_text()) if (ART / 'picks.json').exists() else {}
    picks[args.job] = Path(args.file).resolve().relative_to(ROOT).as_posix()
    (ART / 'picks.json').write_text(json.dumps(picks, indent=1, sort_keys=True))


def dead(args):
    """portrait.<who>.dead: the calm portrait greyed, darkened, with static, scanlines and a thin memorial frame."""
    for sid in args.slots:
        g = np.asarray(Image.open(PICKED / f'{sid}.png').convert('L'), np.float32)
        g = (g - 128) * 0.8 + 128 - 40                                       # flatter and darker
        g += np.random.default_rng(len(sid)).normal(0, 14, g.shape)          # static
        g[::3] *= 0.55                                                       # scanlines
        im = Image.fromarray(np.clip(g, 0, 255).astype(np.uint8)).convert('RGB')
        im = Image.blend(im, Image.new('RGB', im.size, (40, 42, 52)), 0.15)
        d, w = ImageDraw.Draw(im), im.width
        d.rectangle([6, 6, w - 7, w - 7], outline=(160, 160, 160), width=4)
        d.rectangle([16, 16, w - 17, w - 17], outline=(95, 95, 95), width=1)
        save_art(f'{sid}.dead', im)


def sheets(_):
    """remake_art/sheets/<group>.png: every finished file of the group (transparent ones on a checkerboard),
    portraits and ships next to the 1986 original they were redrawn from."""
    cfg = json.loads((ART / 'jobs.json').read_text(encoding='utf8'))
    groups = {'portraits_calm': lambda f: f.startswith('portrait.') and f.count('.') == 1,
              'portraits_stressed': lambda f: f.endswith('.stressed'), 'portraits_dead': lambda f: f.endswith('.dead'),
              'ships_shots_fx': lambda f: f.split('.')[0] in ('ship', 'shot', 'fx'),
              'backgrounds_scenes': lambda f: f.split('.')[0] in ('bg', 'scene', 'view', 'map', 'briefing'),
              'ui_icons_stations': lambda f: f.split('.')[0] in ('logo', 'ui', 'dept', 'station')}
    names = sorted(f.stem for f in PICKED.glob('*.png') if not f.stem.endswith('.calm'))
    (ART / 'sheets').mkdir(exist_ok=True)
    CH, pad, W = 200, 10, 1800

    def tile(im, nearest=False):
        k = min(CH / im.height, 3 * CH / im.width)
        im = im.convert('RGBA').resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.NEAREST if nearest else Image.LANCZOS)
        bg = Image.new('RGBA', im.size, (60, 60, 60, 255)); cd = ImageDraw.Draw(bg)
        for y in range(0, im.height, 16):
            for x in range((y // 16 % 2) * 16, im.width, 32): cd.rectangle([x, y, x + 15, y + 15], fill=(90, 90, 90, 255))
        return Image.alpha_composite(bg, im).convert('RGB')

    for g, test in groups.items():
        cells = []
        for n in filter(test, names):
            orig = cfg['jobs'].get(n, {}).get('original')
            pair = [tile(Image.open(ROOT / orig), True)] if orig and g in ('portraits_calm', 'ships_shots_fx') else []
            ims = pair + [tile(Image.open(PICKED / f'{n}.png'))]
            cell = Image.new('RGB', (sum(i.width for i in ims) + pad * (len(ims) - 1), CH), (22, 20, 26))
            x = 0
            for i in ims: cell.paste(i, (x, 0)); x += i.width + pad
            cells.append((n, cell))
        if not cells: continue
        x = y = pad; rh = 0; pos = []
        for n, c in cells:
            if x + c.width > W: x = pad; y += rh + 24 + pad; rh = 0
            pos.append((n, c, x, y)); x += c.width + 2 * pad; rh = max(rh, c.height)
        sh = Image.new('RGB', (W, y + rh + 24 + pad), (22, 20, 26)); d = ImageDraw.Draw(sh)
        for n, c, x, y in pos:
            d.text((x, y + 4), n, fill=(230, 220, 200)); sh.paste(c, (x, y + 20))
        sh.save(ART / 'sheets' / f'{g}.png'); print('saved', ART / 'sheets' / f'{g}.png', len(cells))


def models(_):
    r = requests.get(f'{API}/models', headers={'Authorization': 'Bearer ' + key()}, timeout=60)
    if r.status_code != 200: sys.exit(f'API error {r.status_code}: {r.text[:300]}')
    print('\n'.join(sorted(m['id'] for m in r.json()['data'] if 'image' in m['id'] or 'dall' in m['id'])))


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('run'); p.add_argument('jobs', nargs='+'); p.add_argument('--n', type=int, default=1)
    p.add_argument('--quality', default='medium', choices=['low', 'medium', 'high'])
    p.add_argument('--model', default='gpt-image-2.5-sunburst'); p.add_argument('--budget', type=float, default=3.0)
    p.add_argument('--skip-done', action='store_true'); p.set_defaults(f=run)
    p = sub.add_parser('pick'); p.add_argument('job'); p.add_argument('file'); p.set_defaults(f=pick)
    p = sub.add_parser('dead'); p.add_argument('slots', nargs='+'); p.set_defaults(f=dead)
    p = sub.add_parser('export'); p.add_argument('ids', nargs='*'); p.set_defaults(f=lambda a: export(a.ids or None))
    sub.add_parser('sheets').set_defaults(f=sheets)
    sub.add_parser('models').set_defaults(f=models)
    sub.add_parser('spent').set_defaults(f=lambda _: print(f'${sum(e["usd"] for e in spend_log()):.2f} in {len(spend_log())} calls'))
    a = ap.parse_args(); a.f(a)
