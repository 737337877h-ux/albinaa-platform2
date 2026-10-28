"""Combine the bundled OFL Arabic/Latin fonts without dropping source glyphs."""
from pathlib import Path
from fontTools.merge import Merger

root = Path(__file__).resolve().parents[1] / 'backend' / 'assets' / 'fonts'
for weight in ('Regular', 'Bold'):
    font = Merger().merge([str(root / f'NotoSansArabic-{weight}.ttf'), str(root / f'NotoSans-{weight}.ttf')])
    for record in font['name'].names:
        values = {1: 'Albinaa Statement', 2: weight, 3: f'AlbinaaStatement-{weight}',
                  4: f'Albinaa Statement {weight}', 6: f'AlbinaaStatement-{weight}'}
        if record.nameID in values:
            record.string = values[record.nameID].encode(record.getEncoding())
    font.save(str(root / f'AlbinaaStatement-{weight}.ttf'))
