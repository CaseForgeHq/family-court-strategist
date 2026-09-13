"""Optional asset refresh: requires fonttools[woff] and Pillow.

Generated fonts/images are committed; deployment has no Python package dependency.
Original fonts, licences and fictional screenshot captures are retained.
"""
from pathlib import Path
from fontTools import subset
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
UNICODES = 'U+0000-024F,U+1E00-1EFF,U+2000-206F,U+20A0-20CF,U+2100-22FF,U+FEFF,U+FFFD'
for source, destination in [('InterVariable.woff2', 'Inter-Latin.woff2'), ('EBGaramond-Variable.ttf', 'EBGaramond-Latin.woff2')]:
    subset.main([str(ROOT / 'brand/fonts' / source), '--unicodes=' + UNICODES,
                 '--flavor=woff2', '--output-file=' + str(ROOT / 'brand/fonts' / destination)])
for source in (ROOT / 'website/media').glob('*.png'):
    if not source.name.startswith(('desktop-', 'phone-')):
        continue
    image = Image.open(source)
    image.save(source.with_suffix('.webp'), format='WEBP', lossless=True, method=6)
    width = 720 if source.name.startswith('desktop-') else 240
    image.resize((width, round(image.height * width / image.width)), Image.Resampling.LANCZOS).save(
        source.with_name(source.stem + '-small.webp'), format='WEBP', quality=88, method=6)
print('Public fonts and image variants updated. Run node scripts/sync-brand.mjs next.')
