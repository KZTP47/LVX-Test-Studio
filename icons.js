// One authored SVG vocabulary for static markup and dynamically rendered legacy views.
// The compatibility map is deliberately confined to this renderer; new UI uses svg(name).
(() => {
 const paths={
  hand:'<path d="M8 13V5a2 2 0 0 1 4 0v7-9a2 2 0 0 1 4 0v9-6a2 2 0 0 1 4 0v9c0 4-2 7-6 7h-2c-3 0-5-2-7-5l-2-4c-1-2 1-4 3-2l2 2Z"/>',
  redo:'<path d="m15 3 6 6-6 6M21 9H9a6 6 0 0 0 0 12"/>',
  minus:'<path d="M4 12h16"/>',
  select:'<path d="m4 3 16 9-7 2-3 7Z"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon:'<path d="M20 14a9 9 0 0 1-10-12 9 9 0 1 0 10 12Z"/>',
  globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/>',
  chart:'<path d="M4 3v17h17M8 16v-5m5 5V6m5 10v-8"/>',
  bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/>',
  refresh:'<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>',
  shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/>',
  users:'<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m3 11v-3a6 6 0 0 0-3-5"/>',
  settings:'<path d="m10 3-1 3-3 1-3 3v4l3 1 1 3 3 3h4l1-3 3-1 3-3v-4l-3-1-1-3-3-3Z"/><circle cx="12" cy="12" r="3"/>',
  test:'<path d="M8 3h8m-6 0v7L4 19a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2l-6-9V3M8 14h8"/>',
  folder:'<path d="M3 7V5h7l2 3h9v12H3Z"/>',
  file:'<path d="M5 3h9l5 5v13H5Zm9 0v6h5M8 13h8m-8 4h6"/>',
  save:'<path d="M4 3h14l3 3v15H3V3Zm3 0v6h10V3M7 21v-8h10v8"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload:'<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  check:'<path d="m4 12 5 5L20 6"/>',
  close:'<path d="m5 5 14 14M19 5 5 19"/>',
  warning:'<path d="m12 3 10 18H2Zm0 6v5m0 3h.01"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  search:'<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
  code:'<path d="m7 6-6 6 6 6m10-12 6 6-6 6M14 3l-4 18"/>',
  play:'<path d="m7 3 14 9-14 9Z"/>',
  pause:'<path d="M7 4v16M17 4v16"/>',
  stop:'<rect x="4" y="4" width="16" height="16" rx="2"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 3"/>',
  mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>',
  link:'<path d="m10 14 4-4m-7 5-2 2a4 4 0 0 0 6 6l3-3m3-11 2-2a4 4 0 0 0-6-6l-3 3" transform="translate(0 -2)"/>',
  branch:'<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M6 7v10m0-5h6a6 6 0 0 0 6-5"/>',
  network:'<rect x="8" y="2" width="8" height="6" rx="1"/><rect x="2" y="17" width="7" height="5" rx="1"/><rect x="15" y="17" width="7" height="5" rx="1"/><path d="M12 8v5H5v4m7-4h7v4"/>',
  database:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
  image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  star:'<path d="m12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1Z"/>',
  edit:'<path d="m4 16 12-12 4 4L8 20H4Zm9-9 4 4"/>',
  plus:'<path d="M12 4v16M4 12h16"/>',
  robot:'<rect x="4" y="6" width="16" height="15" rx="3"/><path d="M12 2v4M8 11h.01M16 11h.01M8 16h8M1 10v6m22-6v6"/>',
  bolt:'<path d="m14 2-11 13h8l-1 7 11-13h-8Z"/>',
  target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  keyboard:'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M5 9h1m3 0h1m3 0h1m3 0h1M5 12h1m3 0h1m3 0h1m3 0h1M6 16h12"/>',
  eye:'<path d="M2 12s4-8 10-8 10 8 10 8-4 8-10 8S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
  bug:'<rect x="7" y="7" width="10" height="14" rx="5"/><path d="M9 7V3m6 4V3M3 9h4m10 0h4M2 14h5m10 0h5M4 21l4-4m8 0 4 4M12 8v13"/>',
  comment:'<path d="M3 3h18v14H8l-5 4Z"/><path d="M7 7h10M7 11h7"/>',
  cloud:'<path d="M6 19a5 5 0 0 1-1-10 7 7 0 0 1 13-2 6 6 0 0 1 0 12Z"/>',
  book:'<path d="M12 5c-4-3-7-3-10-2v16c4-1 7 0 10 2 3-2 6-3 10-2V3c-3-1-6-1-10 2Zm0 0v16"/>',
  dice:'<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M7 7h.01M17 7h.01M12 12h.01M7 17h.01M17 17h.01"/>',
  plug:'<path d="M8 2v6m8-6v6M5 8h14v3a7 7 0 0 1-14 0Zm7 10v4"/>',
  pointer:'<path d="m4 3 16 9-7 2-2 7Z"/>',
  undo:'<path d="m8 3-6 6 6 6M2 9h11a8 8 0 0 1 8 8v4"/>',
  fast:'<path d="m3 5 8 7-8 7Zm10 0 8 7-8 7Z"/>',
  accessibility:'<circle cx="12" cy="3" r="2"/><path d="m4 8 8 2 8-2M12 10v5m0 0-5 7m5-7 5 7"/>',
  container:'<path d="M3 7h18v14H3Zm0 5h18M7 7v14m5-14v14m5-14v14M7 7V3h10v4"/>',
  circle:'<circle cx="12" cy="12" r="8"/>',
  up:'<path d="m6 15 6-6 6 6"/>',
  down:'<path d="m6 9 6 6 6-6"/>',
  activity:'<path d="M2 12h5l3-8 4 16 3-8h5"/>'
 };
 const groups={globe:'🌍 🌐 🌎 🌏',chart:'📊 📈 📉',bell:'🔔',refresh:'🔄 🔃 🔁 ♻️',shield:'🛡️ 🛡 🔐',lock:'🔒 🔓',users:'👥 👤 🧑‍💻',settings:'⚙️ ⚙ 🔧 🛠️',test:'🧪 🔬 ⚗️',folder:'📁 📂 🗂️',file:'📄 📃 📋 📑 📝',save:'💾',download:'📥 ⬇️',upload:'📤 ⬆️',trash:'🗑️ 🗑',check:'✅ ✔️ ✔ ✓ ☑️',close:'❌ ✗ ✖️ ❎',warning:'⚠️ ⚠ 🚨',info:'ℹ️ ℹ 💡',search:'🔍 🔎',code:'💻 🖥️ 📜',play:'▶️ ▶ 🚀',pause:'⏸️ ⏸',stop:'⏹️ ⏹ 🛑',clock:'⏱️ ⏰ 🕐 ⏳ ⌛',mail:'📧 ✉️ 📨',link:'🔗',branch:'🌿 🔀',network:'🕸️ 🕸 🧩',database:'🗄️ 🗃️ 📦',image:'🖼️ 📸 📷',star:'⭐ 🌟 ★ ☆',edit:'✏️ ✏ ✎',plus:'➕',robot:'🤖 🧠 ✨',bolt:'⚡ 🔥 💥',target:'🎯 📌 📍',keyboard:'⌨️'};
 const legacy=new Map();for(const [name,glyphs] of Object.entries(groups))for(const glyph of glyphs.split(' '))legacy.set(glyph,name);
 for(const [name,glyphs] of Object.entries({eye:'👁️ 👁',bug:'🐛',comment:'💬',cloud:'☁️',book:'📚',dice:'🎲',plug:'🔌',pointer:'👆 👇',undo:'↩️',fast:'⏩',accessibility:'♿',container:'🐳 ☸️',circle:'🔴 🟠 🟡 🟢 ⚪',warning:'🚧',play:'⏯️',star:'🎉',clock:'🐌',link:'↗'}))for(const glyph of glyphs.split(' '))legacy.set(glyph,name);
 const segmenter=new Intl.Segmenter('en',{granularity:'grapheme'});
 const isIcon=s=>/\p{Extended_Pictographic}/u.test(s)||legacy.has(s);
 function svg(name='activity',label=''){if(!Object.hasOwn(paths,name))name='activity';const safe=String(label).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));return `<svg class="lvx-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ${safe?`role="img" aria-label="${safe}"`:'aria-hidden="true"'} focusable="false" data-icon="${paths[name]?name:'activity'}">${safe?`<title>${safe}</title>`:''}${paths[name]||paths.activity}</svg>`;}
 function hydrate(root=document.body){
  if(!root||root.nodeType!==1||root.closest('script,style,svg,textarea,pre,code,.monaco-editor,[contenteditable="true"]'))return;
  for(const el of root.querySelectorAll('[data-lvx-icon]')){el.innerHTML=svg(el.dataset.lvxIcon);el.removeAttribute('data-lvx-icon');}
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);const texts=[];while(walker.nextNode())texts.push(walker.currentNode);
  for(const node of texts){if(node.parentElement?.closest('script,style,svg,textarea,pre,code,.monaco-editor,[contenteditable="true"]'))continue;
   const parts=[...segmenter.segment(node.data)].map(x=>x.segment);if(!parts.some(isIcon))continue;
   if(node.parentElement.closest('option,title')){node.data=parts.map(s=>isIcon(s)?'':s).join('');continue;}
   const fragment=document.createDocumentFragment();for(const s of parts){if(isIcon(s)){const holder=document.createElement('span');holder.innerHTML=svg(legacy.get(s)||'activity');fragment.append(holder.firstChild);}else fragment.append(document.createTextNode(s));}node.replaceWith(fragment);
  }
  for(const el of root.querySelectorAll('[title],[aria-label]'))for(const attr of ['title','aria-label'])if(el.hasAttribute(attr))el.setAttribute(attr,[...segmenter.segment(el.getAttribute(attr))].map(x=>isIcon(x.segment)?'':x.segment).join('').trim());
 }
 window.LVXIcons={svg,hydrate,hydrateImported:hydrate,nameOf:glyph=>legacy.get(glyph)||'activity'};
 // Legacy imports may explicitly call hydrateImported(root); application markup uses svg directly.
})();
