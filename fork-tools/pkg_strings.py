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

REGEX_PREV = re.compile(r'(^|[=(,:!&|?{};\[]|\breturn|\btypeof|\bcase)\s*$')

def literals(text):
    """Yield top-level string/template literal matches (with .start/.end/.group('body') semantics),
    skipping METADATA, comments, regex literals and literals on console.* lines.
    Template literals are yielded whole, including any nested ${...} expressions."""
    meta = re.search(r'/\*\s*METADATA.*?\*/', text, re.S)
    n = len(text)
    i = meta.end() if meta and meta.start() < 50 else 0

    def skip_string(j, q):
        j += 1
        while j < n and text[j] != q:
            j += 2 if text[j] == '\\' else 1
        return j + 1

    def skip_template(j):
        j += 1
        while j < n:
            c = text[j]
            if c == '\\':
                j += 2; continue
            if c == '`':
                return j + 1
            if text.startswith('${', j):
                j = skip_code(j + 2, closing='}')
                continue
            j += 1
        return j

    def skip_code(j, closing):
        depth = 0
        while j < n:
            c = text[j]
            if c in '"\'':
                j = skip_string(j, c); continue
            if c == '`':
                j = skip_template(j); continue
            if text.startswith('//', j):
                k = text.find('\n', j); j = n if k < 0 else k; continue
            if text.startswith('/*', j):
                k = text.find('*/', j + 2); j = n if k < 0 else k + 2; continue
            if c == '{':
                depth += 1
            elif c == '}':
                if depth == 0:
                    return j + 1
                depth -= 1
            j += 1
        return j

    class M:
        def __init__(s, a, b):
            s.a, s.b = a, b
        def start(s, g=None):
            return s.a + 1 if g == 'body' else s.a
        def end(s, g=None):
            return s.b - 1 if g == 'body' else s.b
        def group(s, g):
            return text[s.a + 1:s.b - 1]

    def on_console_line(pos):
        ls = text.rfind('\n', 0, pos) + 1
        return re.search(r'console\.(log|error|warn|info|debug)\(', text[ls:pos]) is not None

    while i < n:
        c = text[i]
        if c in '"\'`':
            end = skip_template(i) if c == '`' else skip_string(i, c)
            if not on_console_line(i):
                yield M(i, end)
            i = end; continue
        if text.startswith('//', i):
            k = text.find('\n', i); i = n if k < 0 else k; continue
        if text.startswith('/*', i):
            k = text.find('*/', i + 2); i = n if k < 0 else k + 2; continue
        if c == '/' and REGEX_PREV.search(text[max(0, i - 30):i]):
            m = re.match(r'/(?:\\.|\[(?:\\.|[^\]\n])*\]|[^/\\\n\[])+/[a-z]*', text[i:])
            if m:
                i += m.end(); continue
        i += 1

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
                quote = text[m.start()]
                repl = mapping[body]
                if quote in '\'"':
                    # translations may contain the literal's own quote char; escape it so the source still parses
                    repl = re.sub(r'(?<!\\)' + quote, '\\' + quote, repl)
                out.append(text[last:m.start('body')]); out.append(repl); last = m.end('body'); hits += 1
        out.append(text[last:])
        open(path, 'w', encoding='utf-8').write(''.join(out))
        left = sum(1 for m in literals(''.join(out)) if HAN.search(m.group('body')))
        print(f'{os.path.relpath(path, ROOT)}: replaced {hits}, Chinese literals left {left}')

if __name__ == '__main__':
    {'extract': lambda: extract(sys.argv[2]), 'apply': lambda: apply(sys.argv[2], sys.argv[3])}[sys.argv[1]]()
