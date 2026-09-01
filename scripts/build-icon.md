# 아이콘 다시 만들기

`design/icon/*.svg`를 고친 뒤 아래를 따라 하면 `public/favicon.ico`와
`public/apple-icon.png`가 새로 만들어진다. 파이썬에 `pillow`가, 노드에
`playwright-core`가 있어야 한다(둘 다 개발용이라 서비스에는 들어가지 않는다).

1. 크기마다 정해진 원본으로 PNG를 뽑는다.

   | 크기 | 원본 |
   | --- | --- |
   | 16, 32 | `mark-small.svg` |
   | 48, 64 | `mark-mid.svg` |
   | 128, 256 | `mark-512.svg` |
   | 180 | `mark-apple.svg` |

   브라우저로 SVG를 열어 그 크기의 화면에 그린 뒤 찍으면 된다.

2. 뽑은 PNG들을 한 파일에 담는다.

   ```python
   from PIL import Image
   sizes = [16, 32, 48, 64, 128, 256]
   imgs = [Image.open(f'ico-{s}.png').convert('RGBA') for s in sizes]
   imgs[-1].save('public/favicon.ico', format='ICO',
                 sizes=[(s, s) for s in sizes], append_images=imgs[:-1])
   Image.open('ico-180.png').convert('RGB').save('public/apple-icon.png')
   ```

3. 담긴 크기가 맞는지 확인한다. 큰 그림에서 줄인 것이 아니라 각 크기를
   따로 그려 넣었는지가 중요하다.

   ```python
   from PIL import Image
   ico = Image.open('public/favicon.ico')
   ico.size = (16, 16)   # 이 틀의 그림이 mark-small 에서 나온 것이어야 한다
   ```
