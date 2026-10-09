#!/usr/bin/env python3
"""Translate Chinese string literals in built-in JS tool packages.

The same package exists in three places that must stay in sync:
  examples/<name>.ts, examples/<name>.js, app/src/main/assets/packages/<name>.js

  pkg_strings.py extract <name>          -> prints JSON {chinese_literal_body: ""} for untranslated literals
  pkg_strings.py apply <name> <map.json> -> replaces each literal body (quotes kept) in all copies

Only quoted/template literal *bodies* are replaced, never comments, METADATA, or console.* lines.
"""
import json, os, re, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
HAN = re.compile(r'[一-鿿]')
LIT = re.compile(r'''(?P<q>["'`])(?P<body>(?:\\.|(?!(?P=q)).)*?)(?P=q)''', re.S)

def copies(name):
    out = [os.path.join(ROOT, 'examples', f'{name}.ts'), os.path.join(ROOT, 'examples', f'{name}.js'),
           os.path.join(ROOT, 'app', 'src', 'main', 'assets', 'packages', f'{name}.js')]
    return [p for p in out if os.path.exists(p)]

def code_regions(text):
    """Yield (start, end) spans of code outside METADATA, comments and console.* lines."""
    meta = re.search(r'/\*\s*METADATA.*?\*/', text, re.S)
    skip = []
    if meta:
        skip.append(meta.span())
    i, n = 0, len(text)
    # mask comments while respecting string literals
    while i < n:
        c = text[i]
        if c in '"\'`':
            m = LIT.match(text, i)
            i = m.end() if m else i + 1
            continue
        if text.startswith('//', i):
            j = text.find('\n', i); j = n if j < 0 else j
            skip.append((i, j)); i = j; continue
        if text.startswith('/*', i):
            j = text.find('*/', i + 2); j = n if j < 0 else j + 2
            skip.append((i, j)); i = j; continue
        if c == '/' and re.match(r'[=(,:!&|?{};\n]\s*$', text[max(0, i - 20):i] or '\n'):
            m = re.match(r'/(?:\\.|\[(?:\\.|[^\]])*\]|[^/\\\n\[])+/[a-z]*', text[i:])
            if m:
                skip.append((i, i + m.end())); i += m.end(); continue
        i += 1
    for m in re.finditer(r'^.*console\.(log|error|warn|info|debug)\(.*$', text, re.M):
        skip.append(m.span())
    return skip

def literals(text):
    skip = code_regions(text)
    def skipped(pos):
        return any(a <= pos < b for a, b in skip)
    i, n = 0, len(text)
    while i < n:
        m = LIT.search(text, i)
        if not m:
            break
        if skipped(m.start()):
            i = m.start() + 1; continue
        yield m
        i = m.end()

def extract(name):
    found = {}
    for path in copies(name):
        for m in literals(open(path, encoding='utf-8').read()):
            if HAN.search(m.group('body')):
                found.setdefault(m.group('body'), '')
    print(json.dumps(found, ensure_ascii=False, indent=1))

def apply(name, mapping_path):
    mapping = {k: v for k, v in json.load(open(mapping_path, encoding='utf-8')).items() if v}
    for path in copies(name):
        text = open(path, encoding='utf-8').read()
        out, last, hits = [], 0, 0
        for m in literals(text):
            body = m.group('body')
            if body in mapping:
                out.append(text[last:m.start('body')]); out.append(mapping[body]); last = m.end('body'); hits += 1
        out.append(text[last:])
        open(path, 'w', encoding='utf-8').write(''.join(out))
        left = sum(1 for m in literals(''.join(out)) if HAN.search(m.group('body')))
        print(f'{os.path.relpath(path, ROOT)}: replaced {hits}, Chinese literals left {left}')

if __name__ == '__main__':
    {'extract': lambda: extract(sys.argv[2]), 'apply': lambda: apply(sys.argv[2], sys.argv[3])}[sys.argv[1]]()
