#!/usr/bin/env python3
"""Apply fork-tools/webchat_map.json (Chinese phrase -> English) to web-chat/src.
Longest phrases first; comment and console.* lines are left untouched."""
import json, os, re
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
mapping = json.load(open(os.path.join(ROOT, 'fork-tools', 'webchat_map.json'), encoding='utf-8'))
keys = sorted(mapping, key=len, reverse=True)
skip = re.compile(r'^\s*(//|\*|/\*|\{/\*)|console\.')
for dp, _, fs in os.walk(os.path.join(ROOT, 'web-chat', 'src')):
    for f in fs:
        if not f.endswith(('.ts', '.tsx')):
            continue
        p = os.path.join(dp, f)
        lines = open(p, encoding='utf-8').read().split('\n')
        changed = False
        for i, line in enumerate(lines):
            if skip.search(line) or not re.search(r'[一-鿿]', line):
                continue
            new = line + '\n'
            for k in keys:
                if k in new:
                    new = new.replace(k, mapping[k])
            new = new[:-1]
            if new != line:
                lines[i] = new; changed = True
        if changed:
            open(p, 'w', encoding='utf-8').write('\n'.join(lines))
