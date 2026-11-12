#!/usr/bin/env python3
"""Turn photos sent from the admin page into website photos.

The admin service puts each raw photo in incoming/<id>.jpg and lists it in data/incoming.json:
  {"id", "page": "school:<slug>" | "section:<slug>", "caption", "group"?, "mode": "bag"|"loose"|"whole", "by", "at"}
For each one this script runs scripts/studio.py, saves the result next to the other photos, adds it to
data/schools.json or data/sections.json, then removes the raw photo and the queue entry.
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
                lst, folder = page['uniformPhotos'], J('assets', 'uniforms', slug)
            else:
                page = next(s for s in sections['sections'] if s['slug'] == slug)
                lst, folder = page['photos'], J('assets', 'gallery', slug)
            raw = J('incoming', f"{item['id']}.jpg")
            if not os.path.exists(raw):
                raise RuntimeError('raw photo missing')
            base, n, taken = slugify(item['caption']), 1, {p['file'] for p in lst}
            name = f'{base}.webp'
            while name in taken or os.path.exists(os.path.join(folder, name)):
                n += 1
                name = f'{base}-{n}.webp'
            os.makedirs(folder, exist_ok=True)
            args = [sys.executable, studio, raw, os.path.join(folder, name)]
            if item.get('mode') == 'loose':
                args.append('--loose')
            elif item.get('mode') == 'whole':
                args.append('--whole')
            r = subprocess.run(args, capture_output=True, text=True, timeout=600)
            if r.returncode != 0 or not os.path.exists(os.path.join(folder, name)):
                raise RuntimeError((r.stderr or r.stdout or 'studio failed').strip()[-300:])
            entry = {'file': name, 'caption': item['caption']}
            group = item.get('group') or (school_group(item['caption']) if kind == 'school' else None)
            if group:
                entry['group'] = group
            if item.get('stock') in ('in', 'few', 'out'):
                entry['stock'] = item['stock']
            lst.append(entry)
            os.remove(raw)
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
