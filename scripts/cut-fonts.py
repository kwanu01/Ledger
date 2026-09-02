#!/usr/bin/env python3
"""
한글 활자를 조각으로 나눈다 (app/fonts.css 를 만든다)

왜 나누는가
───────────
나눔명조 한 벌은 이미 자른 뒤에도 204 kB(보통) + 251 kB(굵게) = 455 kB 다.
로마자는 글자가 26개지만 한글은 음절 하나하나가 그림 한 장이라, 흔히 쓰는
것만 추려도 2,780자가 된다.

그런데 한 화면이 실제로 그리는 음절은 200~400자 남짓이다. 나머지는 받아
놓고 한 번도 쓰지 않는다. 폰으로 처음 들어온 사람이 그 값을 낸다.

그래서 조각으로 나누고, 조각마다 어느 글자가 들어 있는지를 unicode-range 로
적어 둔다. 브라우저는 화면에 실제로 나온 글자를 보고 그 글자가 든 조각만
내려받는다. 나머지는 요청조차 하지 않는다.

어떻게 나누는가
───────────────
  core   이 저장소의 한국어 + 화면 문구(i18n)에서 자주 나오는 755자.
         화면의 글씨는 거의 다 이것으로 그려진다. 이 조각만 미리 받는다.
  s1~s12 나머지를 코드포인트 순서로 12조각. 사람이 적어 넣은 이름이나
         품목에 드문 글자가 있을 때만 그 조각 하나가 따라온다.

파일 이름의 8자리는 내용을 줄인 값이다. 활자가 바뀌면 이름이 바뀌므로
브라우저가 옛 조각을 그대로 쓰는 일이 없다 — 그래서 next.config.mjs 에서
1년짜리 immutable 캐시를 걸어 둘 수 있다.

  $ python3 scripts/cut-fonts.py     (저장소 뿌리에서)

fonttools 와 brotli 가 필요하다:  pip install fonttools brotli

조각을 다시 만들면 core 두 조각의 이름이 바뀔 수 있다. 그때는 이 스크립트가
마지막에 찍어 주는 이름을 app/layout.tsx 의 preload 두 줄에 옮겨 적는다.
"""
import collections
import glob
import hashlib
import os
import subprocess

from fontTools.ttLib import TTFont

SRC = 'app/fonts/NanumMyeongjo-{}.subset.woff2'
WEIGHTS = [('Regular', '400'), ('Bold', '700')]
OUT_DIR = 'public/fonts'
CORE_TOP = 700   # 빈도 상위 몇 자를 core 에 넣는가
PIECES = 12      # 나머지를 몇 조각으로 나누는가


def hangul_frequency() -> collections.Counter:
    """이 저장소가 실제로 쓰는 음절과 그 빈도. 화면 문구와 주석이 곧 표본이다."""
    seen: collections.Counter = collections.Counter()
    for pat in ('**/*.ts', '**/*.tsx', '**/*.css', '**/*.sql', '**/*.md'):
        for f in glob.glob(pat, recursive=True):
            # app/fonts.css 는 이 스크립트가 만든 결과물이다. 그것까지 표본에
            # 넣으면 돌릴 때마다 표본이 달라져 조각도 매번 달라진다 — 고칠
            # 것이 없는데 파일 이름이 바뀌어 캐시가 통째로 날아간다.
            if 'node_modules' in f or '.next' in f or f.replace('\\', '/') == 'app/fonts.css':
                continue
            try:
                text = open(f, encoding='utf-8').read()
            except OSError:
                continue
            for ch in text:
                if 0xAC00 <= ord(ch) <= 0xD7A3:
                    seen[ch] += 1
    return seen


def as_ranges(cps) -> str:
    """이어진 코드포인트는 묶어서 적는다. unicode-range 가 짧아진다."""
    cps = sorted(cps)
    spans, a, b = [], cps[0], cps[0]
    for c in cps[1:]:
        if c == b + 1:
            b = c
        else:
            spans.append((a, b))
            a = b = c
    spans.append((a, b))
    return ', '.join(f'U+{x:04X}' if x == y else f'U+{x:04X}-{y:04X}' for x, y in spans)


HEAD = '''/* ==========================================================================
   Ledger — 한글 활자를 조각으로 나눠 심는다

   이 파일은 손으로 쓰지 않는다. scripts/cut-fonts.py 가 만든다.
   왜 이렇게 하는지는 그 스크립트 첫머리에 적어 두었다.
   ========================================================================== */

'''


def main() -> None:
    freq = hangul_frequency()
    ui = {ord(c) for c in open('lib/i18n.ts', encoding='utf-8').read() if 0xAC00 <= ord(c) <= 0xD7A3}

    covered = set(TTFont(SRC.format('Regular')).getBestCmap())
    hangul = {c for c in covered if 0xAC00 <= c <= 0xD7A3}

    # core = 한글이 아닌 것 전부 + 화면 문구 + 빈도 상위. 화면 문구는 빈도와
    # 상관없이 반드시 넣는다 — 한 번만 쓰이는 낱말도 화면에는 늘 떠 있다.
    core = ((covered - hangul) | ui | {ord(c) for c, _ in freq.most_common(CORE_TOP)}) & covered
    rest = sorted(hangul - core)
    step = (len(rest) + PIECES - 1) // PIECES
    slices = [('core', sorted(core))]
    slices += [
        (f's{i + 1}', rest[i * step:(i + 1) * step])
        for i in range(PIECES)
        if rest[i * step:(i + 1) * step]
    ]

    os.makedirs(OUT_DIR, exist_ok=True)
    for old in glob.glob(f'{OUT_DIR}/han-*.woff2'):
        os.remove(old)

    rules, preload = [], []
    for wname, wnum in WEIGHTS:
        for name, cps in slices:
            tmp = f'/tmp/han-{wnum}-{name}.woff2'
            subprocess.run(
                ['python3', '-m', 'fontTools.subset', SRC.format(wname),
                 '--unicodes=' + ','.join(f'U+{c:04X}' for c in cps),
                 '--flavor=woff2', '--no-hinting', '--desubroutinize',
                 '--output-file=' + tmp],
                check=True, capture_output=True)
            digest = hashlib.sha256(open(tmp, 'rb').read()).hexdigest()[:8]
            leaf = f'han-{wnum}-{name}.{digest}.woff2'
            os.replace(tmp, f'{OUT_DIR}/{leaf}')
            if name == 'core':
                preload.append(leaf)
            rules.append(
                '@font-face{\n'
                '  font-family:"Han";\n'
                f'  font-style:normal; font-weight:{wnum}; font-display:swap;\n'
                f'  src:url(/fonts/{leaf}) format("woff2");\n'
                f'  unicode-range:{as_ranges(cps)};\n'
                '}')

    open('app/fonts.css', 'w', encoding='utf-8').write(HEAD + '\n'.join(rules) + '\n')
    print(f'조각 {len(rules)}개 · core {len(core)}자 · 나머지 {len(rest)}자')
    print('app/layout.tsx 의 preload 두 줄을 이 이름으로 맞춰 둘 것:')
    for leaf in preload:
        print('  /fonts/' + leaf)


if __name__ == '__main__':
    main()
