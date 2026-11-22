(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BookingCore=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const districts=['西屯區','南屯區','北屯區','中區','東區','西區','南區','北區','太平區','大里區','霧峰區','烏日區','豐原區','潭子區','大雅區','神岡區','后里區','石岡區','東勢區','新社區','和平區','沙鹿區','梧棲區','清水區','大甲區','外埔區','大安區','龍井區','大肚區'];
  const items=[
    {name:'衣物',image:'cx-item-clothing',detail:'襯衫・日常衣物'},
    {name:'鞋子',image:'cx-item-shoes',detail:'運動鞋・皮鞋'},
    {name:'包包',image:'cx-item-bag',detail:'背包・日常包'},
    {name:'精品・皮件',image:'cx-item-leather',detail:'精品衣物・皮衣'},
    {name:'寢具',image:'cx-item-bedding',detail:'棉被・床組'},
    {name:'嬰幼兒用品',image:'cx-item-baby',detail:'汽座・外出用品'},
    {name:'羽絨外套',image:'item-down-jacket',detail:'換季前先看洗標'},
    {name:'窗簾',image:'item-curtain',detail:'先確認尺寸與材質'},
    {name:'地毯',image:'item-carpet',detail:'先拍整體與背面'},
    {name:'西裝',image:'item-suit',detail:'西裝・精緻衣物'},
    {name:'嬰兒推車',image:'item-stroller',detail:'先確認布套與結構'},
    {name:'白鞋',image:'item-sneaker-white',detail:'鞋面・鞋邊・內裡'}
  ];
  const campaigns=[{"start": "2026-10-26", "end": "2026-11-09", "image": "camp-halloween", "title": "派對之後，讓喜歡的衣物回到日常。", "label": "派對後的洗護", "description": "派對衣物、白鞋與配件，先看糖漿、油彩與亮粉的位置，再依材質評估。"}, {"start": "2026-11-10", "end": "2026-11-30", "image": "camp-winter", "title": "入冬之前，把外套與冬衣準備好。", "label": "入冬換季", "description": "先看外套表面與內裡，再整理品項、件數和方便時段。跟著洗護筆記，慢慢把入冬的衣物準備好。"}, {"start": "2026-12-01", "end": "2026-12-25", "image": "camp-xmas", "title": "聚會之前，把喜歡的那一件準備好。", "label": "聖誕聚會", "description": "聚會想穿的衣物與鞋包，提早拍照詢問，和門市確認處理方式與交期。"}, {"start": "2026-12-26", "end": "2027-02-05", "image": "camp-newyear", "title": "把大件交給我們，留一點時間給家。", "label": "年前整理", "description": "窗簾、地毯與寢具，把大件的材質與尺寸先準備好，再一起安排收送。"}];
  function prefill(params){
    const raw=(params.get('item')||'').split(/[,、]/).map(x=>x.trim()).filter(Boolean);
    const names=items.map(i=>i.name), selected=[...new Set(raw.filter(x=>names.includes(x)))];
    const d=params.get('district')||'',district=districts.includes(d)?d:'';
    return {items:selected,district,warning:(selected.length<new Set(raw).size||(d&&!district))?'連結中有未支援的選項，請重新確認品項與區域。':''};
  }
  function validate(s){
    if(!s.items.length||s.items.some(x=>!items.some(i=>i.name===x)))return '請先選擇至少一個送洗品項。';
    if(!districts.includes(s.district))return '請選擇收送區域。';
    if(!Number.isInteger(s.quantity)||s.quantity<1||s.quantity>99)return '件數請填 1 至 99 的整數。';
    return '';
  }
  function draft(s){
    const lines=['你好，我想預約收送：','品項：'+(s.items.join('、')||'尚未選擇'),'合計件數：'+(Number.isInteger(s.quantity)&&s.quantity>0?s.quantity:'待確認')+' 件','區域：'+(s.district||'尚未選擇'),'交接方式：'+(s.handover||'到府收件'),'方便時段：'+(s.time||'再與門市確認')];
    if(s.note?.trim())lines.push('備註：'+s.note.trim().slice(0,200));
    lines.push('照片另傳。','收送時間與費用，請門市確認。');return lines.join('\n');
  }
  return {districts,items,campaigns,prefill,validate,draft,campaign:day=>campaigns.find(c=>day>=c.start&&day<=c.end)||null,lineURL:text=>'https://line.me/R/oaMessage/%40454foyks/?'+encodeURIComponent(text)};
});
