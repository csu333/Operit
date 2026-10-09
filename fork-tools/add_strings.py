#!/usr/bin/env python3
"""Add strings to the fork-only resource files (values/strings_fork.xml = zh default,
values-en/strings_fork.xml = English). Kept separate from upstream strings.xml so
rebasing onto upstream releases never conflicts.

Input (stdin): one string per line as  key<TAB>zh<TAB>en . Blank lines and lines
starting with # are ignored. Text is XML-escaped and Android-escaped automatically
(apostrophes/quotes); write %1$s-style placeholders as usual.
"""
import os, re, sys
from xml.sax.saxutils import escape

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'src', 'main', 'res')
FILES = {'zh': os.path.join(ROOT, 'values', 'strings_fork.xml'),
         'en': os.path.join(ROOT, 'values-en', 'strings_fork.xml')}
HEADER = '<?xml version="1.0" encoding="utf-8"?>\n<!-- operit-en fork strings: kept out of strings.xml to avoid upstream merge conflicts -->\n<resources>\n'

def existing_keys():
    keys = set()
    for d in ('values', 'values-en'):
        for f in os.listdir(os.path.join(ROOT, d)):
            if f.endswith('.xml'):
                keys |= set(re.findall(r'<string\s+name="([^"]+)"', open(os.path.join(ROOT, d, f), encoding='utf-8').read()))
    return keys

def android_escape(s):
    s = escape(s)
    return s.replace("\\'", "'").replace("'", "\\'").replace('"', '\\"')

def main():
    rows = []
    for line in sys.stdin.read().splitlines():
        if not line.strip() or line.startswith('#'):
            continue
        key, zh, en = line.split('\t')
        rows.append((key.strip(), zh, en))
    taken = existing_keys()
    dupes = [k for k, _, _ in rows if k in taken] + [k for i, (k, _, _) in enumerate(rows) if k in [r[0] for r in rows[:i]]]
    if dupes:
        sys.exit(f'duplicate keys: {dupes}')
    for lang, path in FILES.items():
        text = open(path, encoding='utf-8').read() if os.path.exists(path) else HEADER + '</resources>\n'
        block = ''.join(f'    <string name="{k}">{android_escape(zh if lang == "zh" else en)}</string>\n' for k, zh, en in rows)
        idx = text.rindex('</resources>')
        open(path, 'w', encoding='utf-8').write(text[:idx] + block + text[idx:])
    print(f'added {len(rows)} strings')

if __name__ == '__main__':
    main()
