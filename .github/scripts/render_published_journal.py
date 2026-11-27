"""Merge the durable published-social ledger before the Pages archive is rendered."""
import datetime as dt
import json
import re
import sys
from email.utils import format_datetime
from html import escape
from pathlib import Path
from urllib.parse import urlsplit
from xml.etree import ElementTree as ET

SITE = "https://sixiangjialaundry.com/"
LOCAL = dt.timezone(dt.timedelta(hours=8))
LABEL = {"facebook":"Facebook", "instagram":"Instagram", "youtube":"YouTube"}
HOSTS = {"facebook":{"www.facebook.com","facebook.com"}, "instagram":{"www.instagram.com","instagram.com"}, "youtube":{"www.youtube.com"}}

def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))

def write_json(path, data):
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")

def article(row):
    slug, sources = row["slug"], row["sources"]
    if not re.fullmatch(r"20\d\d-\d\d-\d\d-social-(fa|in|yo)-[A-Za-z0-9_-]+",slug) or not sources:
        raise ValueError("Invalid journal record")
    for kind, s in sources.items():
        u = urlsplit(s["url"])
        if kind not in HOSTS or s["platform"] != kind or u.scheme!="https" or u.netloc not in HOSTS[kind]:
            raise ValueError("Unexpected public source")
        stamp=dt.datetime.fromisoformat(s["time"])
        if stamp.tzinfo is None or stamp > dt.datetime.now(dt.timezone.utc):
            raise ValueError("Unpublished or undated source")
    yt=sources.get("youtube",{})
    body=next((sources[k]["body"] for k in LABEL if k in sources and sources[k]["body"].strip()),"")
    stamp=min(dt.datetime.fromisoformat(s["time"]) for s in sources.values()).astimezone(LOCAL)
    name=(yt.get("title") or next((v.strip() for v in body.splitlines() if v.strip()),"私享家洗護紀錄")).strip()
    path="posts/"+slug+".html"
    vid=yt.get("id")
    if yt and not re.fullmatch(r"[0-9A-Za-z_-]{11}",vid):
        raise ValueError("Invalid public video ID")
    image=f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg" if vid else ""
    rec={"id":SITE+path,"date":stamp.date().isoformat(),"date_published":stamp.isoformat(),"time":stamp.strftime("%H:%M"),
         "slot":0,"category":"洗護紀錄","topic":name,"title":name,"article_path":path,"article_url":SITE+path,"url":SITE+path,
         "media_type":"reel" if any(s["video"] for s in sources.values()) else "post","in_language":"zh-Hant",
         "platforms":list(sources),"image_url":image,"image_urls":[image] if image else [],"video_url":"",
         "facebook_caption":sources.get("facebook",{}).get("body",""),"instagram_caption":sources.get("instagram",{}).get("body",""),
         "facebook_post_url":sources.get("facebook",{}).get("url",""),"instagram_post_url":sources.get("instagram",{}).get("url",""),
         "hashtags":re.findall(r"#[\w]+",body)}
    if vid:
        rec["youtube_video"]={"video_id":vid,"watch_url":yt["url"],"embed_url":"https://www.youtube-nocookie.com/embed/"+vid,"thumbnail_url":image}
    return rec,body

def page(rec,body,sources):
    title, url, stamp = rec["title"],rec["article_url"],rec["date_published"]
    desc=" ".join((body or title).split())[:150]
    schema={"@context":"https://schema.org","@type":"BlogPosting","headline":title,"datePublished":stamp,"description":desc,
            "inLanguage":"zh-Hant-TW","mainEntityOfPage":url,"author":{"@type":"Organization","name":"私享家洗衣店","url":SITE},"sameAs":[s["url"] for s in sources.values()]}
    image=rec["image_url"]
    meta_image=f'<meta property="og:image" content="{escape(image)}">' if image else ""
    if image:
        schema["image"]=image
    scripts=json.dumps(schema,ensure_ascii=False).replace("<","\\u003c")
    links="　".join(f'<a href="{escape(sources[k]["url"])}">{LABEL[k]} 原文</a>' for k in LABEL if k in sources)
    media=""
    if rec.get("youtube_video"):
        media=f'<iframe class="video" loading="lazy" src="{escape(rec["youtube_video"]["embed_url"])}" title="{escape(title)}" allowfullscreen></iframe>'
    elif "instagram" in sources:
        ig=sources["instagram"]["url"]
        if re.fullmatch(r"https://(?:www\.)?instagram\.com/(?:p|reel)/[A-Za-z0-9_-]+/?",ig):
            media=f'<iframe class="photo" loading="lazy" src="{escape(ig.rstrip("/")+"/embed/")}" title="Instagram 原文與配圖"></iframe>'
    paragraphs="\n".join("<p>"+escape(p.strip()).replace("\n","<br>")+"</p>" for p in re.split(r"\n\s*\n",body) if p.strip())
    return f'''<!doctype html>
<html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{escape(title)}｜洗護紀錄</title><link rel="canonical" href="{url}"><meta name="robots" content="index,follow,max-image-preview:large">
<meta name="description" content="{escape(desc)}"><meta property="og:type" content="article"><meta property="og:url" content="{url}">
<meta property="og:title" content="{escape(title)}"><meta property="og:description" content="{escape(desc)}">{meta_image}
<script type="application/ld+json">{scripts}</script><style>
*{{box-sizing:border-box}}body{{margin:0;color:#262d29;background:#fffefa;font:1.05rem/1.85 system-ui,sans-serif}}header,main,footer{{max-width:46rem;margin:auto;padding:1.2rem}}header,footer{{border-bottom:1px solid #d7d9d1}}header a{{font-weight:650}}main{{padding-block:2rem 3rem}}a{{color:#225b4d;text-underline-offset:.22em}}time{{color:#55625b}}h1{{font-size:clamp(1.65rem,5vw,2.5rem);line-height:1.35}}p{{overflow-wrap:anywhere}}iframe{{width:100%;border:0}}.video{{aspect-ratio:16/9}}.photo{{height:36rem;max-width:34rem}}nav{{display:flex;flex-wrap:wrap;gap:1rem}}
</style></head><body><header><nav><a href="/">私享家洗衣店</a><a href="/journal/">洗護紀錄</a></nav></header>
<main><article><time datetime="{stamp}">{rec["date"]}　{rec["time"]}</time><h1>{escape(title)}</h1>{media}{paragraphs}
<p>{links}</p></article></main><footer><nav><a href="/journal/{rec["date"][:7]}/">這個月的洗護紀錄</a><a href="/journal/">全部洗護紀錄</a></nav></footer></body></html>
'''

def splice_managed(text, start, end, before, block):
    left=f"<!-- {start} -->"
    right=f"<!-- {end} -->"
    if left in text or right in text:
        if text.count(left)!=1 or text.count(right)!=1:
            raise ValueError("Invalid journal markers")
        return re.sub(re.escape(left)+".*?"+re.escape(right),lambda _:left+block+right,text,count=1,flags=re.S)
    if before not in text:
        raise ValueError("Missing journal insertion point")
    return text.replace(before,left+block+right+before,1)

def render(root):
    rows=read(root/".github/journal/posts.json")
    posts=[]
    bodies={}
    for row in rows:
        rec,body=article(row)
        if rec["article_url"] in bodies:
            raise ValueError("Duplicate journal URL")
        bodies[rec["article_url"]]=body
        (root/rec["article_path"]).write_text(page(rec,body,row["sources"]),encoding="utf-8")
        posts.append(rec)
    if not posts:
        raise ValueError("Empty journal ledger")
    posts.sort(key=lambda p:p["date_published"])
    newest=posts[-1]
    index=read(root/"social-posts.json")
    for field in ("posts","article_posts"):
        kept=[p for p in index[field] if p["article_url"] not in bodies]
        index[field]=sorted(kept+posts,key=lambda p:(p["date"],p.get("time","")))
    index["latest_date"]=max(p["date"] for p in index["article_posts"])
    write_json(root/"social-posts.json",index)
    latest=read(root/"latest.json")
    latest.update(date=index["latest_date"],posts=[p for p in index["posts"] if p["date"]==index["latest_date"]])
    write_json(root/"latest.json",latest)
    feed=read(root/"feed.json")
    feed["items"]=[r for r in feed["items"] if r["url"] not in bodies]
    for p in posts:
        url=p["article_url"]
        item={"id":url,"url":url,"title":p["title"],"date_published":p["date_published"],"content_text":bodies[url],"tags":p["hashtags"]}
        if p["image_url"]:
            item["image"]=p["image_url"]
        feed["items"].append(item)
    write_json(root/"feed.json",feed)
    rss=root/"rss.xml"
    raw=rss.read_text(encoding="utf-8")
    items=[]
    for p in reversed(posts):
        date=format_datetime(dt.datetime.fromisoformat(p["date_published"]).astimezone(dt.timezone.utc),usegmt=True)
        u=p["article_url"]
        items.append(f'<item><title>{escape(p["title"])}</title><link>{u}</link><guid isPermaLink="true">{u}</guid><pubDate>{date}</pubDate><description>{escape(bodies[u][:180])}</description></item>')
    # Insert ahead of existing entries; keep generated RSS dates newer than this ledger.
    last_build=format_datetime(max(dt.datetime.fromisoformat(str(p.get("date_published") or p["date"]+"T00:00:00+08:00")) for p in index["posts"]).astimezone(dt.timezone.utc),usegmt=True)
    raw=re.sub(r"<lastBuildDate>[^<]*</lastBuildDate>","<lastBuildDate>"+last_build+"</lastBuildDate>",raw,count=1)
    raw=splice_managed(raw,"journal-social-start","journal-social-end","<item>","\n"+"\n".join(items)+"\n")
    ET.fromstring(raw)
    rss.write_text(raw,encoding="utf-8")
    for path in ("sitemap.xml","ai-sitemap.xml"):
        xml=root/path
        raw=xml.read_text(encoding="utf-8")
        known={e.text for e in ET.fromstring(raw).iter() if e.tag.split("}")[-1]=="loc"}
        lines=[f'<url><loc>{p["article_url"]}</loc><lastmod>{p["date"]}</lastmod></url>' for p in posts if p["article_url"] not in known]
        if lines:
            xml.write_text(raw.replace("</urlset>","\n".join(lines)+"\n</urlset>"),encoding="utf-8")
    archive=root/"posts/index.html"
    raw=archive.read_text(encoding="utf-8")
    cards="".join(f'<article class="card article-card"><div class="article-meta">{p["date"]}　{p["time"]}</div><h3><a href="/{p["article_path"]}">{escape(p["title"])}</a></h3></article>' for p in reversed(posts))
    raw=splice_managed(raw,"journal-cards-start","journal-cards-end",'<article class="card article-card">',cards)
    raw=re.sub(r'(內容更新：<time datetime=")[\d-]+(">)[\d-]+(</time>)',lambda m:m[1]+index["latest_date"]+m[2]+index["latest_date"]+m[3],raw,count=1)
    raw=re.sub(r"目前共 \d+ 則紀錄",f'目前共 {len(index["article_posts"])} 則紀錄',raw,count=1)
    archive.write_text(raw,encoding="utf-8")
    print(f'Journal: {len(posts)} verified articles, latest {newest["date"]}')

if __name__=="__main__":
    render(Path(sys.argv[1]) if len(sys.argv)>1 else Path.cwd())
