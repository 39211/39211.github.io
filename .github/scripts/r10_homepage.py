"""Render the R10 static article fallback from the same live index the browser uses."""
import json,re
from html import escape
from pathlib import Path
from urllib.parse import urlsplit

RELEASE=b'data-sxj-release="r10-20261103"'
OPEN=b'<!-- SXJ:RECENT_POSTS -->'
CLOSE=b'<!-- /SXJ:RECENT_POSTS -->'

def is_r10(raw):
    return RELEASE in raw

def records(site_root):
    root=Path(site_root)
    data=json.loads((root/'social-posts.json').read_text(encoding='utf-8-sig'))
    rows=data.get('article_posts')
    if not isinstance(rows,list) or not rows:
        raise ValueError('R10 requires a nonempty public article_posts index')
    unique={}
    for row in rows:
        path=row.get('article_path','').lstrip('/')
        if re.fullmatch(r'posts/[A-Za-z0-9_-]+\.html',path) and re.fullmatch(r'\d{4}-\d{2}-\d{2}',row.get('date','')):
            unique[path]=row
    return sorted(unique.values(),key=lambda p:(p['date'],p['article_path']),reverse=True)

def media_url(value):
    value=str(value or '')
    u=urlsplit(value)
    if value.startswith('/assets/') and not u.netloc and '..' not in u.path:return value
    if u.scheme=='https' and u.hostname in ('sixiangjialaundry.com','i.ytimg.com'):return value
    return ''

def card_image(site_root,image):
    """Use an existing daily WebP on homepage cards only; keep original feeds/media."""
    u=urlsplit(image)
    if u.netloc and (u.scheme!='https' or u.netloc!='sixiangjialaundry.com'):return image
    if u.query or u.fragment or not re.fullmatch(r'/assets/\d{4}-\d{2}-\d{2}/slot-\d{2}\.png',u.path):return image
    derivative=u.path[:-4]+'.webp'
    root=Path(site_root).resolve();target=(root/derivative.lstrip('/')).resolve()
    if not target.is_relative_to(root) or not target.is_file():return image
    return u._replace(path=derivative).geturl()

def recent_cards(site_root,template):
    root=Path(site_root)
    seed_path=root/'scripts/sxj-r10-20261103/r6-posts.json'
    seed=json.loads(seed_path.read_text(encoding='utf-8')) if seed_path.exists() else []
    old={p['article']:p for p in seed}
    html=template.decode('utf-8')
    focus=re.search(r'<section\b[^>]*\bid="focus"[^>]*>(.*?)</section>',html,re.S)
    featured=set(re.findall(r'data-post-open="([^"]+)"',focus.group(1))) if focus else set()
    chosen=[p for p in records(root) if Path(p['article_path']).stem not in featured][:6]
    cards=[]
    for p in chosen:
        article='/'+p['article_path'].lstrip('/');o=old.get(article,{})
        title=p.get('editorial_title') or o.get('title') or p.get('topic') or p.get('title') or '洗護紀錄'
        image=card_image(root,media_url(o.get('image') or p.get('image_url')))
        alt=o.get('imageAlt') or '洗護圖文配圖；來源與說明請見完整紀錄'
        pic=f'<img src="{escape(image,quote=True)}" alt="{escape(alt,quote=True)}" loading="lazy" width="800" height="800"/>' if image else '<span class="r6-missing-photo">洗護紀錄</span>'
        note='<small class="r7-source-note">情境示意</small>' if '示意' in alt or 'AI' in alt else ''
        label='▶ 影片與圖文' if p.get('video_url') or p.get('youtube_video') or o.get('localVideo') else '圖文預覽 ＋'
        cards.append(f'<article class="r6-post"><a class="r6-post-photo" href="{article}" aria-label="閱讀：{escape(title,quote=True)}">{pic}</a><div class="r6-post-copy">{note}<time datetime="{p["date"]}">{p["date"].replace("-"," / ")}</time><h3><a href="{article}">{escape(title)}</a></h3><div class="r6-post-links"><a href="{article}">閱讀全文 ↗</a><a href="{article}" data-post-open="{Path(p["article_path"]).stem}">{label}</a></div></div></article>')
    if not cards:raise ValueError('R10 article fallback is empty')
    return ('\n'+'\n'.join(cards)+'\n').encode('utf-8')


def journal_pages(site_root):
    root=Path(site_root);source=root/'journal/index.html'
    if not source.exists():raise ValueError('R10 journal template missing')
    template=source.read_text(encoding='utf-8');rows=records(root)
    seed=json.loads((root/'scripts/sxj-r10-20261103/r6-posts.json').read_text(encoding='utf-8'))
    old={p['article']:p for p in seed};groups={}
    for row in rows:groups.setdefault(row['date'][:7],[]).append(row)
    months=sorted(groups,reverse=True);pages={}
    for month in [None]+months:
        selected=groups[month] if month else rows[:12]
        title=f'{month[:4]} 年 {int(month[5:])} 月' if month else '洗護紀錄'
        path=f'journal/{month}/index.html' if month else 'journal/index.html'
        canonical='https://sixiangjialaundry.com/'+path.removesuffix('index.html')
        nav='<nav class="month-nav" aria-label="按月份看洗護紀錄"><a href="/journal/"'+(' aria-current="page"' if not month else '')+'>全部月份</a>'
        for m in months:
            nav+=f'<a href="/journal/{m}/"'+(' aria-current="page"' if month==m else '')+f'>{m[:4]} / {int(m[5:])} 月 <small>（{len(groups[m])}）</small></a>'
        nav+='</nav>';cards=[]
        for p in selected:
            article='/'+p['article_path'].lstrip('/');o=old.get(article,{})
            name=p.get('editorial_title') or o.get('title') or p.get('topic') or p.get('title') or '洗護紀錄'
            image=media_url(o.get('image') or p.get('image_url'))
            alt=o.get('imageAlt') or '洗護圖文配圖；來源與說明請見完整紀錄'
            pic=f'<img src="{escape(image,quote=True)}" alt="{escape(alt,quote=True)}" loading="lazy" width="800" height="800"/>' if image else ''
            cards.append(f'<article class="journal-card"><a href="{article}" aria-label="閱讀：{escape(name,quote=True)}">{pic}</a><p class="article-meta"><time datetime="{p["date"]}">{p["date"].replace("-"," / ")}</time>・洗護筆記</p><h3><a href="{article}">{escape(name)}</a></h3><a class="card-link" href="{article}">閱讀完整紀錄 ↗</a></article>')
        count=f'本月 {len(selected)} 篇' if month else f'共 {len(rows)} 篇・以下為最近 12 篇，其餘請選月份'
        main=f'<main id="main"><section class="container section"><div class="archive-intro"><p class="eyebrow">CARE JOURNAL / 一點一點，留下洗護日常</p><h1 class="section-title">{title}</h1><p>從送洗前的判斷，到衣物、鞋包與布品的日常照顧。每篇保留日期，隨時回來找得到。</p></div>{nav}<p class="archive-count">{count}</p><div class="journal-grid">'+''.join(cards)+f'</div><p class="journal-foot">原文配圖如標示 AI 示意，不代表特定客件或保證處理效果。來源與完整說明請見原文。</p>{nav}</section></main>'
        html,n=re.subn(r'<main\b[^>]*>.*?</main>',lambda _:main,template,count=1,flags=re.S)
        if n!=1:raise ValueError('Journal template must have one main')
        html=re.sub(r'<title>.*?</title>',lambda _:f'<title>{title}｜私享家洗衣店</title>',html,count=1,flags=re.S)
        html=re.sub(r'(<link\b(?=[^>]*\brel="canonical")[^>]*\bhref=")[^"]*',lambda m:m[1]+canonical,html,count=1)
        html=re.sub(r'(<meta\b(?=[^>]*\bproperty="og:url")[^>]*\bcontent=")[^"]*',lambda m:m[1]+canonical,html,count=1)
        items=[]
        for position,p in enumerate(selected,1):
            article='/'+p['article_path'].lstrip('/');o=old.get(article,{})
            items.append({'@type':'ListItem','position':position,'url':'https://sixiangjialaundry.com'+article,'name':p.get('editorial_title') or o.get('title') or p.get('topic') or p.get('title') or '洗護紀錄'})
        schema={'@context':'https://schema.org','@type':'CollectionPage','name':title,'url':canonical,'mainEntity':{'@type':'ItemList','itemListElement':items}}
        encoded=json.dumps(schema,ensure_ascii=True,separators=(',',':')).replace('<','\\u003c')
        def update_schema(match):
            data=json.loads(match[1])
            return '<script type="application/ld+json">'+encoded+'</script>' if data.get('@type')=='CollectionPage' else match[0]
        html=re.sub(r'<script type="application/ld\+json">(.*?)</script>',update_schema,html,flags=re.S)
        pages[path]=html.encode('utf-8')
    return pages

def render_journals(site_root):
    from xml.etree import ElementTree as ET
    root=Path(site_root);pages=journal_pages(root)
    for path,raw in pages.items():
        target=root/path;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(raw)
    sitemap=root/'sitemap.xml';raw=sitemap.read_text(encoding='utf-8');tree=ET.fromstring(raw)
    existing={e.text for e in tree.iter() if e.tag.split('}')[-1]=='loc'}
    added=[]
    for path in pages:
        url='https://sixiangjialaundry.com/'+path.removesuffix('index.html')
        if url not in existing:added.append(f'  <url><loc>{url}</loc></url>')
    if added:sitemap.write_text(raw.replace('</urlset>','\n'.join(added)+'\n</urlset>'),encoding='utf-8')
    return pages
