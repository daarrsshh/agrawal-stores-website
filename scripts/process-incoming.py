#!/usr/bin/env python3
"""Turn photos sent from the admin page into website photos.

The admin service puts each raw photo in incoming/<id>.jpg and lists it in data/incoming.json:
  {"id", "page": "school:<slug>" | "section:<slug>", "caption", "group"?, "mode": "bag"|"loose"|"whole", "by", "at"}
For each one this script runs scripts/studio.py, saves the result next to the other photos, adds it to
data/schools.json or data/sections.json, keeps the raw photo in originals/<uniforms|gallery>/<slug>/<name>.jpg
(so it can be edited again) and removes the queue entry.

The owner can also ask for a photo to be edited again ("redo"):
  {"id", "redo": "<file>.webp", "page", "caption", "mode", "by"}
The kept original is run through scripts/studio.py again with the new mode and replaces the website photo.
A photo that fails is left in the queue with an "error" so it can be looked at; the others still go through.

usage: python3 scripts/process-incoming.py [--studio scripts/studio.py]
"""
import json, os, re, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
J = lambda *p: os.path.join(ROOT, *p)


def load(p):
    with open(J(p), encoding='utf-8') as f:
        return json.load(f)


def save(p, data):
    with open(J(p), 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write('\n')


def slugify(text):
    s = re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')
    return (s or 'photo')[:50].strip('-')


def school_group(caption):
    c = caption.lower()
    if any(w in c for w in ('winter', 'sweater', 'blazer', 'jacket')):
        return 'Winter wear'
    if any(w in c for w in ('house', 'track', 'stripe', 'sports')):
        return 'House & sports wear'
    return 'Daily wear'


def mode_args(mode):
    return ['--loose'] if mode == 'loose' else ['--whole'] if mode == 'whole' else []


def run_studio(studio, raw, out, mode):
    r = subprocess.run([sys.executable, studio, raw, out, *mode_args(mode)], capture_output=True, text=True, timeout=600)
    if r.returncode != 0 or not os.path.exists(out):
        raise RuntimeError((r.stderr or r.stdout or 'studio failed').strip()[-300:])


def main():
    studio = sys.argv[sys.argv.index('--studio') + 1] if '--studio' in sys.argv else J('scripts', 'studio.py')
    queue_path = 'data/incoming.json'
    if not os.path.exists(J(queue_path)):
        print('nothing queued')
        return 0
    queue = load(queue_path).get('photos', [])
    schools, sections = load('data/schools.json'), load('data/sections.json')
    left, done = [], 0
    for item in queue:
        if item.get('error'):
            left.append(item)
            continue
        try:
            kind, slug = item['page'].split(':', 1)
            if kind == 'school':
                page = next(s for s in schools['schools'] if s['slug'] == slug)
                lst, sub = page['uniformPhotos'], 'uniforms'
            else:
                page = next(s for s in sections['sections'] if s['slug'] == slug)
                lst, sub = page['photos'], 'gallery'
            folder, keep = J('assets', sub, slug), J('originals', sub, slug)
            if item.get('redo'):
                name = os.path.basename(item['redo'])
                if not any(p['file'] == name for p in lst):
                    raise RuntimeError('photo to edit again not found')
                original = os.path.join(keep, os.path.splitext(name)[0] + '.jpg')
                if not os.path.exists(original):
                    raise RuntimeError('the original photo was not kept, so it cannot be edited again')
                tmp = os.path.join(folder, '.redo-' + name)
                run_studio(studio, original, tmp, item.get('mode'))
                os.replace(tmp, os.path.join(folder, name))
                thumb = os.path.join(folder, 'thumb', name)
                if os.path.exists(thumb):
                    os.remove(thumb)
                done += 1
                print(f"edited again {kind}/{slug}/{name} ({item.get('mode')}, by {item.get('by')})")
                continue
            raw = J('incoming', f"{item['id']}.jpg")
            if not os.path.exists(raw):
                raise RuntimeError('raw photo missing')
            base, n, taken = slugify(item['caption']), 1, {p['file'] for p in lst}
            name = f'{base}.webp'
            while name in taken or os.path.exists(os.path.join(folder, name)):
                n += 1
                name = f'{base}-{n}.webp'
            os.makedirs(folder, exist_ok=True)
            run_studio(studio, raw, os.path.join(folder, name), item.get('mode'))
            entry = {'file': name, 'caption': item['caption']}
            group = item.get('group') or (school_group(item['caption']) if kind == 'school' else None)
            if group:
                entry['group'] = group
            if item.get('by'):
                entry['by'] = str(item['by'])[:20]
            if item.get('stock') in ('in', 'few', 'out'):
                entry['stock'] = item['stock']
            lst.append(entry)
            os.makedirs(keep, exist_ok=True)
            os.replace(raw, os.path.join(keep, os.path.splitext(name)[0] + '.jpg'))
            done += 1
            print(f"added {kind}/{slug}/{name}: {item['caption']} (by {item.get('by')})")
        except Exception as e:  # keep going with the rest
            item['error'] = str(e)
            left.append(item)
            print(f"FAILED {item.get('id')}: {e}", file=sys.stderr)
    save('data/schools.json', schools)
    save('data/sections.json', sections)
    save(queue_path, {'photos': left})
    print(f'{done} photo(s) added, {len(left)} left')
    return 1 if any(i.get('error') for i in left) else 0


if __name__ == '__main__':
    sys.exit(main())
