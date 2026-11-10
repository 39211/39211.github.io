"""Synchronize homepage-only content dates after the SEO overlay, never build time."""
import json
import re
from datetime import date, datetime
from xml.etree import ElementTree as ET

CANONICAL = 'https://sixiangjialaundry.com/'
OPEN = '<!-- SXJ:RECENT_POSTS -->'
CLOSE = '<!-- /SXJ:RECENT_POSTS -->'

def day(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?', value):
        raise ValueError('Invalid content date')
    date.fromisoformat(value[:10])
    if len(value) > 10: datetime.fromisoformat(value)
    return value[:10]

def objects(raw):
    stack=[]; quoted=False; escaped=False
    for i,ch in enumerate(raw):
        if quoted:
            if escaped: escaped=False
            elif ch=='\\': escaped=True
            elif ch=='"': quoted=False
        elif ch=='"': quoted=True
        elif ch=='{': stack.append(i)
        elif ch=='}':
            start=stack.pop()
            yield start,i+1,json.loads(raw[start:i+1])

def sync_homepage_dates(html, sitemap):
    """Return both byte strings atomically, or unchanged with a diagnostic reason."""
    try:
        text=html.decode('utf-8');xml=sitemap.decode('utf-8')
        if text.count(OPEN)!=1 or text.count(CLOSE)!=1 or text.index(CLOSE)<text.index(OPEN):
            raise ValueError('Malformed homepage recent-post markers')
        inside=text.split(OPEN)[1].split(CLOSE)[0]
        dates=[day(value) for value in re.findall(r'<time\b[^>]*\bdatetime=[\'"]([^\'"]+)[\'"]',inside)]
        candidates=[]
        for script in re.finditer(r'<script\b[^>]*>(.*?)</script\s*>',text,re.S|re.I):
            tag=script[0].split('>',1)[0]
            if not re.search(r'\btype\s*=\s*([\'"])application/ld\+json\1',tag,re.I):continue
            raw=script[1];json.loads(raw)
            for start,end,node in objects(raw):
                types=node.get('@type',[]);types=types if isinstance(types,list) else [types]
                home=node.get('url')==CANONICAL or ('url' not in node and node.get('@id')==CANONICAL+'#webpage')
                if 'WebPage' in types and home:candidates.append((script.start(1)+start,script.start(1)+end,node))
        if len(candidates)!=1:raise ValueError('Missing or ambiguous homepage WebPage')
        start,end,node=candidates[0]
        if 'dateModified' in node:dates.append(day(node['dateModified']))
        if not dates:raise ValueError('No defensible homepage content date')
        latest=max(dates)
        ET.fromstring(xml)
        entries=[]
        for entry in re.finditer(r'<url\b[^>]*>.*?</url\s*>',xml,re.S):
            parsed=ET.fromstring(entry[0]);locs=[child.text for child in parsed if child.tag.split('}')[-1]=='loc']
            if locs==[CANONICAL]:entries.append(entry)
        if len(entries)!=1:raise ValueError('Missing or ambiguous homepage sitemap URL')
        entry=entries[0];mods=list(re.finditer(r'<lastmod\b[^>]*>(.*?)</lastmod\s*>',entry[0],re.S))
        if len(mods)>1:raise ValueError('Ambiguous homepage sitemap date')
        for mod in mods:day(mod[1].strip())
        # Only the matched homepage node is serialized; unrelated script/node bytes stay intact.
        if node.get('dateModified')==latest:next_node=text[start:end]
        else:
            node['dateModified']=latest
            next_node=json.dumps(node,ensure_ascii=False,separators=(',',':')).replace('<','\\u003c')
        if mods:
            mod=mods[0];next_entry=entry[0][:mod.start(1)]+latest+entry[0][mod.end(1):]
        else:next_entry=re.sub(r'</url\s*>$',f'<lastmod>{latest}</lastmod></url>',entry[0])
        return ((text[:start]+next_node+text[end:]).encode('utf-8'),
                (xml[:entry.start()]+next_entry+xml[entry.end():]).encode('utf-8'),'')
    except (ValueError,TypeError,KeyError,IndexError,ET.ParseError) as exc:
        return html,sitemap,str(exc)
