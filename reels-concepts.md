# Reels concepts, for approval before anything is generated

Six concepts covering six different object types. Nothing gets generated until
these scripts are approved: the last batch produced images for a business this
is not, and that is a review that should have happened here instead.

## What the first batch got wrong

- **Laundry baskets.** That is self-service vocabulary. This shop collects and
  delivers; a customer never handles a basket here.
- **Clothes piled on a home sofa.** That is someone's living room, not this
  shop, and without a script it reads as an unexplained stock scene.
- **Clothing only.** The shop handles shoes, bags, bedding, plush toys, suits
  and luxury items. One object type is not the business.

Only the white shirt pair was usable, and it worked because it was the actual
object on the actual counter with the actual problem visible.

## Rules every concept follows

- **The scene is the inspection counter.** Not a home, not a laundromat, not a
  showroom. Where the work is really done.
- **One object type per Reel**, and no two consecutive Reels share a type.
- **A state, not a transformation.** Two stills, two clips, joined. The model
  cannot hold a change inside one shot.
- **A forearm or a tool at the edge of frame.** Never a hand in close-up.
- **Subtitles carry the whole message** — 40% watch muted.
- **Narration is short**, Taiwanese Mandarin, plain, no advert voice.

---

## 1. 白鞋泛黃 — white sneakers

**Object:** one pair of white sneakers, midsole edge greyed
**Stills:** `white-shoe/reel-yellowing-before.png` / `-after.png`

| | |
|---|---|
| Hook 0–2s | 白鞋泛黃,不是刷得不夠用力 |
| Middle | 是中底和鞋邊的膠條吃進髒 |
| Close | 台中收送,拍給我們看能不能救 |

**TTS:** 白鞋放久會泛黃,問題通常不在鞋面,在中底和鞋邊。硬刷只會讓布面起毛。拍給我們看,先幫你判斷。

---

## 2. 包包提把 — handbag handle

**Object:** everyday handbag, handle darkened where it is held
**Stills:** `handbag/reel-handle-before.png` / `-after.png`

| | |
|---|---|
| Hook 0–2s | 包包最先變舊的地方,是提把 |
| Middle | 手汗和保養品會慢慢堆成一層油光 |
| Close | 提把開始發黏就可以私訊我們 |

**TTS:** 包包最先看起來變舊的,幾乎都是提把。那不是灰塵,是手汗和保養品堆起來的。發黏之前處理,比較好救。

---

## 3. 皮鞋雨痕 — leather shoes

**Object:** leather dress shoes, faint rain marks across the vamp
**Stills:** `leather-shoe/reel-rain-before.png` / `-after.png`

| | |
|---|---|
| Hook 0–2s | 皮鞋淋雨,擦乾就沒事了嗎 |
| Middle | 水痕會過幾天才浮出來 |
| Close | 別急著上油,先拍給我們看 |

**TTS:** 皮鞋淋過雨,擦乾當下看起來沒事,水痕通常過幾天才浮出來。這時候上油反而會讓顏色不均。

---

## 4. 絨毛玩偶 — plush toy

**Object:** one plush toy, fur flattened and dulled
**Stills:** `plush-doll/reel-plush-before.png` / `-after.png`

| | |
|---|---|
| Hook 0–2s | 娃娃不是不能洗,是不能亂洗 |
| Middle | 填充物和黏貼的五官怕的是脫水 |
| Close | 家裡有不敢洗的娃娃?私訊我們 |

**TTS:** 娃娃可以洗,但不能當一般衣服洗。填充物和黏上去的五官,最怕的是脫水那一段。

---

## 5. 棉被收納 — duvet before storage

**Object:** folded duvet on the counter, storage bag beside it
**Stills:** `duvet/reel-storage-before.png` / `-after.png`

| | |
|---|---|
| Hook 0–2s | 棉被收進櫃子前,先聞一下 |
| Middle | 帶著濕氣收起來,下一季就有味道 |
| Close | 換季前想清一次?台中收送 |

**TTS:** 棉被收進櫃子之前先聞一下。表面乾不代表裡面乾,帶著濕氣收起來,下一季拿出來就是那個味道。

---

## 6. 精品包邊角 — luxury bag corner

**Object:** leather bag corner, edge coating worn
**Stills:** `leather-bag/reel-corner-before.png` / `-after.png`

| | |
|---|---|
| Hook 0–2s | 精品包最怕的不是髒,是邊角 |
| Middle | 邊油磨掉之後就補不回原樣 |
| Close | 邊角開始磨就該處理了 |

**TTS:** 精品包最先出問題的是邊角。邊油一旦磨掉,就補不回原本的樣子,所以要在磨穿之前處理。

---

## Shared still prompt

Applied to all twelve stills, with the subject swapped in. The *after* image of
each pair is edited from its *before* so the two match.

> Ordinary square shop photo for 私享家洗衣店. [SUBJECT] on the inspection counter
> of a Taiwanese laundry and item-care shop. Shot on a phone by shop staff,
> handheld with slight natural camera shake and imperfect framing, tiled floor
> and metal racks visible, soft fluorescent ceiling light mixed with cool window
> daylight from the left at roughly 4500K, consistent shadow direction, realistic
> material texture with genuine wear, everyday clutter at the edge of frame.
> No laundry basket, no washing machine, no domestic living room, no shopfront.
> Not cinematic, not studio lighting, not glossy, not perfectly symmetrical,
> no stock-photo feel, no dramatic colour grade. No brand name, no logo,
> no readable text, no watermark, no faces.

## Scheduling

Six concepts covers roughly two weeks at three a week, and no two consecutive
Reels repeat an object type. Per-Reel thresholds and the day 30 rules are in
`docs/reels-roadmap.md`.
