"""Extract supplied logo outlines, without redrawing, from the brand guide's page 10.
Usage: python3 scripts/extract-brand-assets.py /path/to/Case_Forge_Brand_Guidelines.pdf
Requires PyMuPDF. Run only when updating source artwork; normal builds use checked-in SVGs.
"""
import copy, re, sys
from pathlib import Path
import xml.etree.ElementTree as ET
import fitz
S = 'http://www.w3.org/2000/svg'
X = 'http://www.w3.org/1999/xlink'
ET.register_namespace('', S)
ET.register_namespace('xlink', X)
page = fitz.open(sys.argv[1])[9]
source = ET.fromstring(page.get_svg_image(text_as_path=True))
glyphs = []
for el in source.iter(f'{{{S}}}use'):
    n = [float(v) for v in re.findall(r'[-+]?(?:\d*\.)?\d+', el.get('transform', ''))]
    if len(n) == 6 and 120 < n[4] < 385 and 190 < n[5] < 235:
        glyphs.append(el)
assert ''.join(e.get('data-text', '') for e in glyphs) == 'CASE FORGE'
mark = []
for drawing in page.get_drawings():
    if fitz.Rect(60, 168, 120, 250).contains(drawing['rect']) and drawing['fill']:
        points = []
        for item in drawing['items']:
            assert item[0] == 'l', 'Unexpected logo geometry; inspect the revised guide.'
            points.extend(item[1:])
        unique = []
        for p in points:
            if not unique or tuple(p) != unique[-1]: unique.append(tuple(p))
        colour = '#' + ''.join(f'{round(c * 255):02x}' for c in drawing['fill'])
        mark.append(ET.Element(f'{{{S}}}polygon', {'points': ' '.join(f'{x:.6f},{y:.6f}' for x,y in unique), 'fill': colour}))
assert len(mark) == 4
out = Path(__file__).resolve().parents[1] / 'brand'
for name, symbol, reverse in [('logo', False, False), ('logo-reversed', False, True), ('symbol', True, False), ('favicon', True, False)]:
    root = ET.Element(f'{{{S}}}svg', {'viewBox': '50.89 158.76 77.64 99.82' if symbol else '50.89 158.76 348.98 99.82', 'role':'img'})
    ET.SubElement(root, f'{{{S}}}title').text = 'Case Forge'
    if not symbol:
        ids = {g.get(f'{{{X}}}href')[1:] for g in glyphs}
        defs = ET.SubElement(root, f'{{{S}}}defs')
        for el in source.find(f'{{{S}}}defs'):
            if el.get('id') in ids: defs.append(copy.deepcopy(el))
    for el in mark: root.append(copy.deepcopy(el))
    if not symbol:
        for g in glyphs:
            g = copy.deepcopy(g)
            if reverse: g.set('fill', '#f8f4ec')
            root.append(g)
    if name == 'favicon':
        root.set('viewBox', '56.44 175.39 66.55 66.55')
        for el in root.findall(f'{{{S}}}polygon'): el.set('fill', '#a84424')
    ET.ElementTree(root).write(out / f'{name}.svg', encoding='unicode')
print('Extracted four vector assets from the supplied PDF.')
