/* Interface Lens: inspetor visual. Execute como Snippet ou injete em qualquer página.
 * Lê DOM, estilos, caixas de texto e ícones; não altera o conteúdo da página.
 * API: VisualInspector.report(), .context(), .audit(), .measurements(), .snapshot(), .diff(),
 *      .select(), .toggleGuides(), .togglePanel(), .movePanel(), .remove().
 */
function installVisualInspector(options) {
  'use strict';
  options = options || {};
  window.VisualInspector?.remove();
  const VERSION='3.0.0';
  const style=options.mockStyle || null;
  const hooks=options.selectors || {};
  const nameAttributes=options.nameAttributes || [];
  const query=s=>s ? document.querySelector(s) : null;
  const svgNS='http://www.w3.org/2000/svg';
  const ACTION='button,a[href],summary,[role="button"],[role="link"],[role="menuitem"],[role="menuitemradio"]';
  const CONTROL=ACTION+',input:not([type="hidden"]),textarea,select,[role="textbox"],[role="checkbox"],[role="switch"],[role="slider"],[role="progressbar"],[role="menuitemcheckbox"],[role="tab"],[role="option"]';

  const guides=document.createElementNS(svgNS,'svg');
  guides.id='visual-inspector-guides';
  guides.setAttribute('aria-hidden','true');
  guides.style.cssText='position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:2147483000';
  document.body.append(guides);

  // O painel vive em shadow root: o CSS da página não o alcança e ele não vaza estilos.
  const host=document.createElement('div');
  host.id='visual-inspector-panel';
  host.style.cssText='all:initial;position:fixed;left:0;top:0;z-index:2147483001';
  const shadow=host.attachShadow({mode:'open'});
  const h=(tag,props,...kids)=>{
    const e=document.createElement(tag);
    for (const [key,value] of Object.entries(props || {})) {
      if (value===false || value==null) continue;
      if (key==='class') e.className=value;
      else if (key==='style') e.style.cssText=value;
      else if (key==='text') e.textContent=value;
      else if (key.startsWith('on')) e.addEventListener(key.slice(2),value);
      else e.setAttribute(key,value===true ? '' : value);
    }
    e.append(...kids.flat(Infinity).filter(k=>k!=null && k!==false));
    return e;
  };
  const glyph=d=>{
    const s=document.createElementNS(svgNS,'svg'), p=document.createElementNS(svgNS,'path');
    s.setAttribute('viewBox','0 0 16 16'); s.setAttribute('aria-hidden','true'); p.setAttribute('d',d); s.append(p);
    return s;
  };
  const sheet=new CSSStyleSheet();
  sheet.replaceSync(`
    *,*::before,*::after { box-sizing:border-box; }
    .panel { --bg:#151515; --raised:#232323; --line:rgba(255,255,255,.1); --fg:#f4f4f5; --muted:#a1a1aa; --faint:#8b8b94; --accent:#f87171; --focus:#93c5fd;
      display:flex; flex-direction:column; width:360px; max-width:calc(100vw - 32px); overflow:hidden; color:var(--fg); background:var(--bg); border:1px solid var(--line); border-radius:14px;
      box-shadow:0 1px 2px rgba(0,0,0,.3),0 12px 32px rgba(0,0,0,.36); font:12px/18px system-ui,-apple-system,"Segoe UI",sans-serif; font-variant-numeric:tabular-nums; -webkit-font-smoothing:antialiased; color-scheme:dark; }
    header { display:flex; align-items:center; gap:2px; height:40px; padding:0 5px; cursor:grab; user-select:none; touch-action:none; }
    .dragging header { cursor:grabbing; }
    .title { flex:1; min-width:0; display:flex; align-items:baseline; gap:8px; padding-left:2px; white-space:nowrap; overflow:hidden; }
    .title strong { font-size:13px; font-weight:600; }
    .title span { overflow:hidden; text-overflow:ellipsis; color:var(--faint); }
    button { margin:0; padding:0; border:0; background:none; color:inherit; font:inherit; cursor:pointer; }
    button:focus-visible,.body:focus-visible { outline:2px solid var(--focus); outline-offset:-2px; }
    .icon { flex:none; display:grid; place-items:center; width:28px; height:28px; border-radius:8px; color:var(--muted); }
    .icon:hover { background:rgba(255,255,255,.08); color:var(--fg); }
    .icon[aria-pressed="false"] { color:#63636b; }
    .icon svg { width:16px; height:16px; fill:none; stroke:currentColor; stroke-width:1.5; stroke-linecap:round; stroke-linejoin:round; }
    .grip { cursor:inherit; }
    .grip svg { stroke-width:2; }
    .text { height:28px; padding:0 8px; border-radius:8px; color:var(--muted); white-space:nowrap; }
    .text:hover { background:rgba(255,255,255,.08); color:var(--fg); }
    .tabs { display:flex; gap:2px; margin:0 8px 8px; padding:2px; border-radius:10px; background:rgba(255,255,255,.05); }
    .tabs button { flex:1; display:flex; align-items:center; justify-content:center; gap:6px; height:28px; border-radius:8px; color:var(--muted); font-weight:500; }
    .tabs button:hover { color:var(--fg); }
    .tabs button[aria-selected="true"] { background:var(--raised); color:var(--fg); box-shadow:0 1px 2px rgba(0,0,0,.4); }
    .badge { min-width:18px; height:18px; padding:0 5px; border-radius:9px; background:rgba(248,113,113,.16); color:var(--accent); font-size:11px; line-height:18px; text-align:center; }
    .badge[data-zero] { background:rgba(255,255,255,.07); color:var(--faint); }
    .body { max-height:min(340px,calc(100vh - 140px)); overflow:auto; padding:4px 12px 12px; overscroll-behavior:contain; scrollbar-width:thin; }
    .minimized .tabs,.minimized .body { display:none; }
    p { margin:0; }
    .empty { padding:6px 0 2px; color:var(--muted); }
    .hint { padding-top:4px; color:var(--faint); }
    .path { margin:4px 0 10px; color:var(--muted); }
    .path b { color:var(--fg); font-weight:500; }
    h3 { display:flex; align-items:baseline; gap:6px; margin:14px 0 6px; color:var(--faint); font-size:11px; font-weight:500; letter-spacing:.04em; text-transform:uppercase; }
    h3:first-child { margin-top:4px; }
    h3 small { font-size:inherit; letter-spacing:0; text-transform:none; }
    dl { display:grid; grid-template-columns:92px minmax(0,1fr); gap:4px 12px; margin:0; }
    dt { color:var(--muted); }
    dd { margin:0; overflow-wrap:anywhere; }
    .mono { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:11px; }
    .sw { display:inline-block; width:10px; height:10px; margin-right:6px; border-radius:3px; vertical-align:-1px; box-shadow:inset 0 0 0 1px rgba(255,255,255,.2); }
    .chips { display:flex; flex-wrap:wrap; gap:4px; }
    .chip { padding:2px 8px; border-radius:999px; background:rgba(255,255,255,.07); white-space:nowrap; }
    .chip small { margin-left:4px; color:var(--faint); font-size:inherit; }
    .tokens { display:grid; grid-template-columns:1fr 1fr; gap:4px 12px; }
    .tokens div { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .findings { display:flex; flex-direction:column; gap:2px; margin:0 -8px; padding:0; list-style:none; }
    .findings button { display:grid; grid-template-columns:6px minmax(0,1fr) auto; gap:2px 8px; align-items:baseline; width:100%; padding:8px; border-radius:8px; text-align:left; }
    .findings button:hover,.findings button[aria-current="true"] { background:rgba(255,255,255,.07); }
    .dot { align-self:center; width:6px; height:6px; border-radius:50%; background:var(--accent); }
    .dot[data-kind="candidato"] { background:#fbbf24; }
    .dot[data-kind="requisito"] { background:#60a5fa; }
    .name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:500; }
    .delta { color:var(--muted); }
    .message { grid-column:2 / -1; color:var(--muted); }
    .row { display:flex; justify-content:flex-end; margin-top:12px; }
    @media (prefers-reduced-motion:no-preference) { .icon,.text,.tabs button,.findings button { transition:background-color .12s,color .12s; } }
  `);
  const summary=h('span');
  const grip=h('button',{class:'icon grip',type:'button','aria-label':'Mover painel com as setas do teclado',title:'Arraste para mover; duplo clique reposiciona'},glyph('M6 4h.01M10 4h.01M6 8h.01M10 8h.01M6 12h.01M10 12h.01'));
  const compare=style && h('button',{class:'text',type:'button',text:'Ver original',onclick:()=>toggle()});
  const eye=h('button',{class:'icon',type:'button','aria-label':'Guias','aria-pressed':'true',title:'Mostrar ou ocultar guias',onclick:()=>toggleGuides()},glyph('M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8ZM8 6.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Z'));
  const fold=h('button',{class:'icon',type:'button','aria-label':'Minimizar painel','aria-expanded':'true',title:'Minimizar ou expandir',onclick:()=>setMinimized(!minimized)},glyph('M4 6l4 4 4-4'));
  const close=h('button',{class:'icon',type:'button','aria-label':'Fechar inspetor',title:'Fechar inspetor',onclick:()=>api.remove()},glyph('M4.5 4.5l7 7M11.5 4.5l-7 7'));
  const head=h('header',null,grip,h('div',{class:'title'},h('strong',{text:'Interface Lens'}),summary),compare,eye,fold,close);
  const TABS=[['inspect','Inspeção'],['findings','Achados'],['context','Contexto']];
  const badge=h('span',{class:'badge','data-zero':true,text:'0'});
  const tabButtons=TABS.map(([id,text])=>h('button',{type:'button',role:'tab',id:'vi-tab-'+id,'aria-controls':'vi-body',onclick:()=>setTab(id)},text,id==='findings' && badge));
  const tabs=h('div',{class:'tabs',role:'tablist','aria-label':'Seções do inspetor'},tabButtons);
  const body=h('div',{class:'body',id:'vi-body',role:'tabpanel',tabindex:'0'});
  const panel=h('section',{class:'panel','aria-label':'Interface Lens'},head,tabs,body);
  // Elemento de prova para resolver tokens; a cor sentinela do pai denuncia valores que não são cor.
  const probe=h('i'), SENTINEL='rgb(1, 2, 3)';
  shadow.adoptedStyleSheets=[sheet];
  shadow.append(panel,h('i',{hidden:true,style:'color:'+SENTINEL},probe));
  document.body.append(host);

  let geometryCache=new WeakMap(), styleCache=new WeakMap(), roots=[document];
  const up=e=>e.parentElement || (e.parentNode instanceof ShadowRoot ? e.parentNode.host : null);
  const all=s=>roots.flatMap(r=>[...r.querySelectorAll(s)]);
  const own=e=>e===host || guides.contains(e);
  function collectRoots() {
    roots=[document];
    for (let i=0; i<roots.length; i++) for (const e of roots[i].querySelectorAll('*')) if (e.shadowRoot && e!==host) roots.push(e.shadowRoot);
  }
  const box = e => {
    if (!geometryCache.has(e)) geometryCache.set(e,e.getBoundingClientRect());
    return geometryCache.get(e);
  };
  const computed = e => {
    if (!styleCache.has(e)) styleCache.set(e,getComputedStyle(e));
    return styleCache.get(e);
  };
  const visible = e => {
    const b = box(e);
    if (!(b.width > 0 && b.height > 0 && b.right > 0 && b.x < innerWidth && b.bottom > 0 && b.y < innerHeight)) return false;
    let left = Math.max(0, b.left), right = Math.min(innerWidth, b.right);
    let top = Math.max(0, b.top), bottom = Math.min(innerHeight, b.bottom);
    for (let a=e; a; a=up(a)) {
      const c = computed(a), r = box(a);
      if (c.visibility === 'hidden' || c.opacity === '0' || c.display === 'none' || c.clipPath === 'inset(50%)' || c.clip === 'rect(0px, 0px, 0px, 0px)') return false;
      if (a !== e && /auto|scroll|hidden|clip/.test(c.overflowX)) { left=Math.max(left,r.left); right=Math.min(right,r.right); }
      if (a !== e && /auto|scroll|hidden|clip/.test(c.overflowY)) { top=Math.max(top,r.top); bottom=Math.min(bottom,r.bottom); }
    }
    return right > left && bottom > top;
  };
  const centerX = e => box(e).x + box(e).width / 2;
  const centerY = e => box(e).y + box(e).height / 2;
  const spread = v => v.length ? Math.max(...v) - Math.min(...v) : 0;
  const round = n => Math.round(n * 10) / 10;
  const textContext = document.createElement('canvas').getContext('2d');
  const bounds = r => ({ x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom });
  const midY = r => r.y + r.height/2;
  const floating = e => ['absolute','fixed'].includes(computed(e).position);

  // Cores: o canvas converte qualquer sintaxe de cor (oklch, color-mix, nomes) para sRGB.
  const colorContext=document.createElement('canvas').getContext('2d',{willReadFrequently:true});
  const colorCache=new Map();
  function rgba(value) {
    if (colorCache.has(value)) return colorCache.get(value);
    let out=null;
    const m=/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(value || '');
    if (m) out=[+m[1],+m[2],+m[3],m[4]===undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4])/100 : +m[4]];
    else if (value && CSS.supports('color',value)) {
      colorContext.clearRect(0,0,1,1); colorContext.fillStyle=value; colorContext.fillRect(0,0,1,1);
      const d=colorContext.getImageData(0,0,1,1).data;
      out=[d[0],d[1],d[2],d[3]/255];
    }
    colorCache.set(value,out);
    return out;
  }
  const hex=c=>'#'+[c[0],c[1],c[2],...(c[3]<1 ? [c[3]*255] : [])].map(n=>Math.round(n).toString(16).padStart(2,'0')).join('');
  const over=(top,base)=>[0,1,2].map(i=>top[i]*top[3]+base[i]*(1-top[3])).concat(1);
  const linear=c=>{ c/=255; return c<=.04045 ? c/12.92 : ((c+.055)/1.055)**2.4; };
  const luminance=c=>.2126*linear(c[0])+.7152*linear(c[1])+.0722*linear(c[2]);
  const contrast=(a,b)=>{ const x=luminance(a), y=luminance(b); return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); };
  function canvasColor() {
    const scheme=computed(document.documentElement).colorScheme || '';
    const dark=/dark/.test(scheme) && (!/light/.test(scheme) || matchMedia('(prefers-color-scheme: dark)').matches);
    return dark ? [18,18,18,1] : [255,255,255,1];
  }
  // Cor efetiva atrás do elemento; null quando imagem, gradiente, filtro ou opacidade impedem a leitura.
  function backdrop(e) {
    const layers=[];
    let base=null;
    for (let a=e; a && !base; a=up(a)) {
      const c=computed(a);
      if (c.backgroundImage!=='none' || +c.opacity<1 || c.filter!=='none') return null;
      const bg=rgba(c.backgroundColor);
      if (bg && bg[3]===1) base=bg; else if (bg && bg[3]>0) layers.push(bg);
    }
    base ||= canvasColor();
    for (const layer of layers.reverse()) base=over(layer,base);
    return base;
  }
  const radiusOf=e=>{
    const v=computed(e).borderTopLeftRadius.split(' ')[0], n=parseFloat(v) || 0, b=box(e);
    return Math.min(v.endsWith('%') ? n/100*b.width : n,Math.min(b.width,b.height)/2);
  };
  const surface=e=>{
    const c=computed(e), bg=rgba(c.backgroundColor);
    return !!(bg && bg[3]) || parseFloat(c.borderTopWidth)>0 || c.boxShadow!=='none';
  };

  // Seletor único no seu root; elementos em shadow root usam "host >>> interno".
  function selector(e) {
    const root=e.getRootNode(), tag=e.localName;
    const unique=s=>{ try { return root.querySelectorAll(s).length===1; } catch { return false; } };
    const scope=hooks.scope && e.closest(hooks.scope) ? hooks.scope+' ' : '';
    const candidates=[];
    for (const a of ['aria-label','data-testid',...nameAttributes]) if (e.getAttribute(a)) candidates.push(scope+tag+'['+a+'='+JSON.stringify(e.getAttribute(a))+']');
    if (e.id && !e.id.includes(':')) candidates.push('#'+CSS.escape(e.id));
    if (e.classList.length) candidates.push(scope+tag+[...e.classList].slice(0,2).map(c=>'.'+CSS.escape(c)).join(''));
    let found=candidates.find(unique);
    if (!found) {
      const path=[];
      for (let a=e; a; a=a.parentElement) {
        if (a.id && !a.id.includes(':') && unique('#'+CSS.escape(a.id))) { path.unshift('#'+CSS.escape(a.id)); break; }
        const same=[...(a.parentNode?.children || [a])].filter(c=>c.localName===a.localName);
        path.unshift(a.localName+(same.length>1 ? ':nth-of-type('+(same.indexOf(a)+1)+')' : ''));
        if (unique(path.join(' > '))) break;
      }
      found=path.join(' > ');
    }
    return root instanceof ShadowRoot ? selector(root.host)+' >>> '+found : found;
  }
  function find(path) {
    let scope=document, e=null;
    for (const part of String(path).split(' >>> ')) {
      e=scope.querySelector(part);
      if (!e) return null;
      scope=e.shadowRoot || e;
    }
    return e;
  }
  function fontMetrics(text, css) {
    textContext.font = `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
    return textContext.measureText(text);
  }
  function clipText(rect, parent) {
    let left=rect.x, right=rect.right, top=rect.y, bottom=rect.bottom;
    for (let a=parent; a; a=up(a)) {
      const css=computed(a), r=box(a);
      if (/auto|scroll|hidden|clip/.test(css.overflowX)) { left=Math.max(left,r.left); right=Math.min(right,r.right); }
      if (/auto|scroll|hidden|clip/.test(css.overflowY)) { top=Math.max(top,r.top); bottom=Math.min(bottom,r.bottom); }
    }
    return { x:left, y:top, width:Math.max(0,right-left), height:Math.max(0,bottom-top), right, bottom };
  }
  function partsFor(control, content=false) {
    const parts=[];
    const owner = e => e.closest(ACTION);
    for (const icon of control.querySelectorAll('svg,img'+(hooks.icons ? ','+hooks.icons : ''))) {
      if ((owner(icon) === control || content && !owner(icon)) && visible(icon)) parts.push({ type:'Ícone', element:icon, bounds:bounds(box(icon)) });
    }
    const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node=walker.currentNode, parent=node.parentElement, text=node.textContent.trim();
      if (!text || !parent || (!content && owner(parent)!==control) || parent.closest('.sr-only,[aria-hidden="true"]') || !visible(parent)) continue;
      const range=document.createRange(); range.selectNodeContents(node);
      const css=computed(parent), metrics=fontMetrics(text,css);
      for (const rect of range.getClientRects()) {
        const clipped=clipText(rect,parent);
        if (clipped.width && clipped.height) parts.push({ type:'Texto', element:parent, text, bounds:clipped,
          baselineApprox:rect.y+metrics.fontBoundingBoxAscent,
          inkTopApprox:rect.y+metrics.fontBoundingBoxAscent-metrics.actualBoundingBoxAscent,
          inkBottomApprox:rect.y+metrics.fontBoundingBoxAscent+metrics.actualBoundingBoxDescent });
      }
    }
    // Texto gerado por CSS não tem Text node. A posição é inferida do flex real.
    for (const pseudo of ['::before','::after']) {
      const css=getComputedStyle(control,pseudo);
      let text=css.content;
      if (!text || text==='none' || text==='normal' || text==='""') continue;
      const attr=text.match(/^attr\(([^)]+)\)$/);
      if (attr) text=control.getAttribute(attr[1]) || '';
      else if (/^["']/.test(text)) text=text.slice(1,-1);
      if (!text.trim()) continue;
      const parentCss=computed(control), b=box(control), metrics=fontMetrics(text,css);
      const fontHeight=metrics.fontBoundingBoxAscent+metrics.fontBoundingBoxDescent;
      const gap=parseFloat(parentCss.columnGap)||0;
      let x=b.x+(b.width-metrics.width)/2;
      if (parts.length && /flex/.test(parentCss.display) && parentCss.flexDirection==='row') {
        x=pseudo==='::after' ? Math.max(...parts.map(p=>p.bounds.right))+gap : Math.min(...parts.map(p=>p.bounds.x))-gap-metrics.width;
      } else if (parentCss.justifyContent!=='center') {
        x=b.x+(parseFloat(parentCss.borderLeftWidth)||0)+(parseFloat(parentCss.paddingLeft)||0);
      }
      const y=centerY(control)-fontHeight/2;
      parts.push({ type:'Texto CSS', element:control, text, inferred:true,
        bounds:{ x,y,width:metrics.width,height:fontHeight,right:x+metrics.width,bottom:y+fontHeight },
        baselineApprox:y+metrics.fontBoundingBoxAscent });
    }
    return parts;
  }

  // Nome do componente de framework cujo elemento raiz é este nó, quando o runtime o expõe.
  // Nomes de até dois caracteres vêm de builds minificados e não identificam nada.
  const GENERIC=/^(.{1,2}$|Primitive\.|Slot|SlotClone|Fragment|Suspense|ForwardRef|Memo|Anonymous|Presence|Portal|_c\d*$)|(Provider|Context|Consumer)$/;
  const seen={react:false,vue:false};
  function componentName(e) {
    const key=Object.keys(e).find(k=>k.startsWith('__reactFiber$'));
    if (key) {
      seen.react=true;
      const owners=[];
      let source;
      for (let f=e[key]?.return; f && typeof f.type!=='string' && owners.length<4; f=f.return) {
        const t=f.type, name=typeof t==='function' ? t.displayName || t.name : t && typeof t==='object' ? t.displayName || t.render?.displayName || t.render?.name || t.type?.displayName || t.type?.name : '';
        if (!name || GENERIC.test(name)) continue;
        owners.push(name);
        if (!source && f._debugSource) source=f._debugSource.fileName.split(/[\\/]/).slice(-3).join('/')+':'+f._debugSource.lineNumber;
      }
      if (owners.length) return { name:owners[0], owners:owners.slice(1), source, via:'React' };
    }
    if (e.__vueParentComponent) {
      seen.vue=true;
      const owners=[];
      let source;
      for (let i=e.__vueParentComponent; i && i.subTree?.el===e && owners.length<4; i=i.parent) {
        const name=i.type?.__name || i.type?.name;
        if (!name) continue;
        owners.push(name);
        source ||= i.type.__file;
      }
      if (owners.length) return { name:owners[0], owners:owners.slice(1), source, via:'Vue' };
    }
    const file=e.__svelte_meta?.loc?.file;
    if (file) return { name:file.split(/[\\/]/).pop().replace(/\.svelte$/,''), owners:[], source:file+':'+e.__svelte_meta.loc.line, via:'Svelte' };
    for (const a of ['data-slot','data-component']) if (e.getAttribute(a)) return { name:e.getAttribute(a), owners:[], via:a };
    if (e.localName.includes('-')) return { name:'<'+e.localName+'>', owners:[], via:'elemento customizado' };
    return null;
  }

  let componentMap = new Map();
  let hovered = null;
  let pinned = null;
  function identify(controls) {
    const textParents=new Set();
    for (const root of roots) {
      const walker=document.createTreeWalker(root===document ? document.body : root,NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const p=walker.currentNode.parentElement;
        if (!p || p.children.length || own(p) || p.closest('script,style,noscript,svg,.sr-only,[aria-hidden="true"]')) continue;
        if (walker.currentNode.textContent.trim() && visible(p)) textParents.add(p);
      }
    }
    const groups = all('nav,main,aside,section,header,footer,form,label,p,li,pre,blockquote,table,th,td,article,[role="article"],[role="dialog"],[role="group"],h1,h2,h3,video,audio,canvas,iframe,svg,img'+(hooks.components ? ','+hooks.components : ''));
    for (const icon of groups.filter(e=>e.matches('svg,img'))) {
      const parent=icon.parentElement;
      if (parent && parent.children.length===1 && !parent.textContent.trim() && /flex|grid/.test(computed(parent).display)) groups.push(parent);
    }
    const nodes = [...new Set([...groups, ...controls, ...textParents])].filter(e => !own(e) && visible(e));
    const nodeSet = new Set(nodes);
    const components = nodes.map(e => {
      let parent = up(e);
      while (parent && !nodeSet.has(parent)) parent = up(parent);
      let level = 0;
      for (let a=parent; a; a=up(a)) if (nodeSet.has(a)) level++;
      const custom=options.describe?.(e) || {};
      const role=e.getAttribute('role');
      const type=custom.type || ({ NAV:'Navegação', MAIN:'Conteúdo', ASIDE:'Barra lateral', BUTTON:'Botão', A:'Link', SUMMARY:'Ação expansível', LABEL:'Rótulo', P:'Parágrafo', LI:'Item', PRE:'Código', BLOCKQUOTE:'Citação', TABLE:'Tabela', TH:'Célula', TD:'Célula', ARTICLE:'Artigo', H1:'Título', H2:'Título', H3:'Título', INPUT:'Campo', TEXTAREA:'Campo', SELECT:'Seletor', SECTION:'Seção', FORM:'Formulário', SVG:'Ícone', IMG:'Imagem', VIDEO:'Vídeo', AUDIO:'Áudio', CANVAS:'Canvas', IFRAME:'Frame' }[e.tagName.toUpperCase()] ||
        { button:'Botão', textbox:'Campo', dialog:'Diálogo', group:'Grupo', slider:'Slider', progressbar:'Progresso', menuitem:'Item de menu', menuitemradio:'Opção de menu', menuitemcheckbox:'Opção de menu', tab:'Aba', option:'Opção' }[role] || (textParents.has(e) ? 'Texto' : 'Grupo'));
      const name=custom.name || ['aria-label',...nameAttributes,'alt','title'].map(a=>e.getAttribute(a)).find(Boolean) || (['Botão','Linha','Título','Texto','Link'].includes(type) ? e.textContent.trim().slice(0,64) : type);
      return { element:e, parent, level, type, name, component:componentName(e) };
    });
    componentMap = new Map(components.map(c => [c.element,c]));
    return { components, textParents };
  }
  function measure() {
    // Uma leitura por elemento em cada snapshot; nunca reaproveitar após edição.
    geometryCache=new WeakMap();styleCache=new WeakMap();
    collectRoots();
    const sidebar=query(hooks.sidebar);
    const composer=query(hooks.composer);
    const main=query(hooks.main || 'main');
    const rows=sidebar && hooks.rows ? [...sidebar.querySelectorAll(hooks.rows)].filter(visible) : [];
    const labels=rows.map(row=>options.labelForRow ? options.labelForRow(row) : hooks.label ? row.querySelector(hooks.label) : null).filter(Boolean);
    const toolbarRoot=options.toolbarRoot?.(composer) || query(hooks.toolbar);
    const toolbar=toolbarRoot ? [...toolbarRoot.querySelectorAll('button')].filter(e=>visible(e) && box(e).y>=box(toolbarRoot).y-1 && box(e).bottom<=box(toolbarRoot).bottom+1) : [];
    const controls = all(CONTROL).filter(e => !own(e) && visible(e));
    const sidebarActions = sidebar && hooks.actions ? [...sidebar.querySelectorAll(hooks.actions)].filter(visible) : [];
    const { components, textParents } = identify(controls);
    const internals = controls.filter(e=>e.matches(ACTION)).map(e=>({ element:e, parts:partsFor(e) }));
    for (const c of components.filter(c=>c.type==='Texto' || c.element.matches('p,h1,h2,h3,th,td,label'))) internals.push({element:c.element,parts:partsFor(c.element,true)});
    const labelLevels=new Map();
    for (const e of labels) {
      const level=componentMap.get(hooks.rows ? e.closest(hooks.rows) : e)?.level || 0;
      if (!labelLevels.has(level)) labelLevels.set(level,[]);
      labelLevels.get(level).push(box(e).x);
    }
    return {
      sidebar, composer, main, rows, labels, toolbar, controls, sidebarActions, components, internals, textParents,
      textDelta: Math.max(0,...[...labelLevels.values()].map(spread)),
      toolbarDelta: spread(toolbar.map(centerY)),
      actionDelta: spread(sidebarActions.map(centerX)),
      composerDelta: composer && main ? Math.abs(centerX(composer) - centerX(main)) : null
    };
  }

  // Valor compartilhado pela maioria; null quando não há maioria clara.
  function majority(values, tolerance) {
    let best=null, count=0;
    for (const v of values) {
      const n=values.filter(o=>Math.abs(o-v)<=tolerance).length;
      if (n>count) { best=v; count=n; }
    }
    return count>=2 && count>values.length/2 ? best : null;
  }
  function contentStart(e) {
    let x=Infinity, read=0;
    for (const icon of e.querySelectorAll('svg,img')) if (visible(icon)) x=Math.min(x,box(icon).x);
    const walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT);
    while (walker.nextNode() && read<20) {
      const node=walker.currentNode;
      if (!node.textContent.trim() || !node.parentElement || !visible(node.parentElement)) continue;
      const range=document.createRange(); range.selectNodeContents(node);
      for (const rect of range.getClientRects()) if (rect.width) x=Math.min(x,rect.x);
      read++;
    }
    return x;
  }
  // Filhos repetidos do mesmo contêiner, na ordem do DOM, dispostos em uma linha ou em uma coluna.
  function siblingGroups(m, tolerance) {
    const parents=new Set();
    for (const c of m.components) for (let p=c.element.parentElement, depth=0; p && depth<2; p=p.parentElement, depth++) parents.add(p);
    const groups=[];
    for (const parent of parents) {
      if (own(parent) || parent.children.length<3 || parent.children.length>200) continue;
      const kids=[...parent.children].filter(k=>!own(k) && visible(k) && !floating(k));
      if (kids.length<3 || kids.some(k=>k.localName!==kids[0].localName)) continue;
      if (/^(div|span)$/.test(kids[0].localName) && kids.some(k=>k.className!==kids[0].className || !k.className)) continue;
      const after=(a,b,start,end)=>box(b)[start]>=box(a)[end]-tolerance;
      const row=kids.every((k,i)=>!i || after(kids[i-1],k,'x','right') && box(k).y<box(kids[i-1]).bottom && box(k).bottom>box(kids[i-1]).y);
      const column=!row && kids.every((k,i)=>!i || after(kids[i-1],k,'y','bottom'));
      if (row || column) groups.push({ kids, row });
    }
    return groups;
  }
  const findingElement=new WeakMap();
  function inspectRules(m) {
    const findings=[];
    // 1 CSS px absorve arredondamento subpixel de fonte/DPR; não esconde 2–4px.
    const tolerance=options.tolerancePx ?? 1;
    function flag(rule, e, delta, message, confidence, extra) {
      if (options.rules?.[rule]===false) return;
      const finding={ rule, selector:selector(e), component:e.getAttribute('aria-label') || e.textContent.trim().slice(0,64), deltaPx:delta===null ? null : round(delta), tolerancePx:tolerance, confidence, message, bounds:bounds(box(e)), ...extra };
      findingElement.set(finding,e);
      findings.push(finding);
    }
    function add(rule, e, delta, message, confidence='medido') {
      if (delta>tolerance) flag(rule,e,delta,message,confidence);
    }
    if (m.labels.length) add('coluna-titulos',m.labels[0],m.textDelta,'Títulos do mesmo nível começam em colunas diferentes.');
    if (m.toolbar.length) {
      add('centro-toolbar',m.toolbar[0],m.toolbarDelta,'Os centros verticais dos botões da barra configurada diferem.');
      add('altura-toolbar',m.toolbar[0],spread(m.toolbar.map(e=>box(e).height)),'Há alturas diferentes no mesmo grupo de botões.');
    }
    const header=m.sidebar && hooks.headerActions ? [...m.sidebar.querySelectorAll(hooks.headerActions)].filter(visible) : [];
    if (m.sidebarActions.length && header.length) add('coluna-acoes',header[0],spread([...m.sidebarActions,...header].map(centerX)),'As ações configuradas têm eixos horizontais diferentes.','candidato');
    if (options.requirements?.noComposerShadow && m.composer && computed(m.composer).boxShadow!=='none') flag('sombra-prompt',m.composer,null,'A sombra ainda está presente no componente configurado.','requisito');
    for (const {element:e,parts} of m.internals) {
      if (!e.matches(ACTION)) continue;
      const texts=parts.filter(p=>p.type.startsWith('Texto')), icons=parts.filter(p=>p.type==='Ícone');
      const css=computed(e);
      if (!parts.length) continue;
      const ys=parts.map(p=>midY(p.bounds));
      if (texts.length===1 && icons.length && /center/.test(css.alignItems)) {
        add('icone-texto-y',e,spread(ys),'Centro da caixa de texto e dos ícones difere; conferir alinhamento óptico.','candidato');
      }
      if (icons.length===1 && !texts.length && /center/.test(css.alignItems)) {
        add('icone-botao-y',e,Math.abs(midY(icons[0].bounds)-centerY(e)),'O ícone está fora do centro vertical do botão.');
        add('icone-botao-x',e,Math.abs(icons[0].bounds.x+icons[0].bounds.width/2-centerX(e)),'O ícone está fora do centro horizontal do botão.');
      }
      if (css.justifyContent==='center' && texts.length<=1) {
        const left=Math.min(...parts.map(p=>p.bounds.x)), right=Math.max(...parts.map(p=>p.bounds.right));
        add('conteudo-botao-x',e,Math.abs((left+right)/2-centerX(e)),'O conjunto texto/ícone está fora do centro horizontal do botão.','candidato');
      }
    }
    const textOwners=new Set(m.internals.filter(c=>c.parts.some(p=>p.type.startsWith('Texto'))).map(c=>c.element));
    for (const {element:e} of m.components) {
      const parent=e.parentElement;
      if (parent && !e.matches('svg,img') && !floating(e)) {
        const css=computed(parent), self=computed(e).alignSelf;
        if (/flex/.test(css.display) && css.flexDirection==='row' && css.flexWrap==='nowrap' && css.alignItems==='center' && (self==='auto'||self==='center')) {
          add('componente-linha-y',e,Math.abs(centerY(e)-centerY(parent)),'O componente está deslocado do eixo vertical da sua linha; confira a intenção.','candidato');
        }
        // Curvas concêntricas: dentro da zona da curva do pai, o raio interno é o externo menos o recuo.
        const outer=radiusOf(parent), inner=radiusOf(e), gapX=box(e).x-box(parent).x, gapY=box(e).y-box(parent).y;
        if (inner && outer>gapX && gapX>=0 && Math.abs(gapX-gapY)<=tolerance && surface(e) && surface(parent)) {
          add('raio-concentrico',e,Math.abs(inner-(outer-gapX)),`Raio de ${round(inner)} px dentro de um contêiner com ${round(outer)} px e recuo de ${round(gapX)} px; o raio concêntrico seria ${round(outer-gapX)} px.`,'candidato');
        }
      }
      if (textOwners.has(e) || e.matches(ACTION)) continue;
      if (e.children.length!==1 || !e.firstElementChild.matches('svg,img') || e.textContent.trim()) continue;
      const css=computed(e), icon=e.firstElementChild;
      if (!/flex|grid/.test(css.display) || !visible(icon)) continue;
      if (css.alignItems==='center') add('icone-slot-y',e,Math.abs(centerY(icon)-centerY(e)),'O ícone não está no centro vertical da sua caixa.');
      if (css.justifyContent==='center' || css.justifyItems==='center') add('icone-slot-x',e,Math.abs(centerX(icon)-centerX(e)),'O ícone não está no centro horizontal da sua caixa.');
    }
    // Irmãos repetidos são comparados entre si: a referência é a maioria, nunca um valor fixo.
    for (const {kids,row} of siblingGroups(m,tolerance)) {
      const [start,end]=row ? ['x','right'] : ['y','bottom'];
      const gaps=kids.slice(1).map((k,i)=>box(k)[start]-box(kids[i])[end]), gap=majority(gaps,tolerance);
      if (gap!==null) gaps.forEach((g,i)=>add('ritmo-gap',kids[i+1],Math.abs(g-gap),`Espaço de ${round(g)} px antes deste item; os irmãos usam ${round(gap)} px.`,'candidato'));
      if (row && kids.every(k=>k.matches(CONTROL))) {
        const heights=kids.map(k=>box(k).height), height=majority(heights,tolerance);
        if (height!==null) kids.forEach((k,i)=>add('dimensao-irmaos',k,Math.abs(heights[i]-height),`Altura de ${round(heights[i])} px; os irmãos da linha medem ${round(height)} px.`,'candidato'));
      }
      if (!row && spread(kids.map(k=>box(k).x))<=tolerance && kids.every(k=>/^(start|left|-webkit-auto)$/.test(computed(k).textAlign) && computed(k).justifyContent!=='center')) {
        const starts=kids.map(contentStart), edge=majority(starts.filter(Number.isFinite),tolerance);
        const off=edge===null ? [] : kids.filter((k,i)=>Number.isFinite(starts[i]) && Math.abs(starts[i]-edge)>tolerance);
        if (off.length<=Math.max(1,Math.floor(kids.length/4))) for (const k of off) {
          const x=starts[kids.indexOf(k)];
          add('borda-inicial',k,Math.abs(x-edge),`O conteúdo começa em x=${round(x)}; os irmãos começam em x=${round(edge)}.`,'candidato');
        }
      }
    }
    const clippers=new Set(), pairs=new Map();
    for (const p of m.textParents) {
      for (const c of [p,p.parentElement]) {
        if (!c || clippers.has(c) || own(c)) continue;
        const css=computed(c);
        if (!/hidden|clip/.test(css.overflowX+css.overflowY) || css.textOverflow==='ellipsis' || css.webkitLineClamp!=='none' || box(c).width<8) continue;
        const hiddenX=/hidden|clip/.test(css.overflowX) ? c.scrollWidth-c.clientWidth : 0, hiddenY=/hidden|clip/.test(css.overflowY) ? c.scrollHeight-c.clientHeight : 0;
        clippers.add(c);
        add('texto-cortado',c,Math.max(hiddenX,hiddenY),`Texto cortado sem reticências: ${round(Math.max(hiddenX,hiddenY))} px ficam ocultos.`,'candidato');
      }
      if (p.closest('[disabled],[aria-disabled="true"]')) continue;
      const css=computed(p), fg=rgba(css.color), bg=backdrop(p);
      if (!fg || !fg[3] || !bg) continue;
      const size=parseFloat(css.fontSize), need=size>=24 || size>=18.66 && +css.fontWeight>=700 ? 3 : 4.5, ratio=contrast(over(fg,bg),bg);
      if (ratio>=need) continue;
      const key=hex(fg)+hex(bg)+need, pair=pairs.get(key) || pairs.set(key,{ element:p, count:0, ratio, need, fg:hex(fg), bg:hex(bg) }).get(key);
      pair.count++;
    }
    for (const p of pairs.values()) {
      flag('contraste-texto',p.element,null,`Contraste de ${round(p.ratio)}:1 entre o texto ${p.fg} e o fundo ${p.bg}; WCAG AA pede ${p.need}:1${p.count>1 ? ` (${p.count} ocorrências)` : ''}.`,'candidato',{ ratio:round(p.ratio), count:p.count });
    }
    for (const e of m.controls) {
      if (!e.matches(ACTION)) continue;
      if (!e.textContent.trim() && !['aria-label','aria-labelledby','title'].some(a=>e.getAttribute(a)) && !e.querySelector('img[alt]:not([alt=""]),svg title')) {
        flag('controle-sem-nome',e,null,'Controle sem texto nem nome acessível (aria-label, aria-labelledby ou title).','medido');
      }
      if (computed(e).display==='inline') continue;
      const expanded=['::before','::after'].some(pseudo=>{
        const c=getComputedStyle(e,pseudo);
        return c.content!=='none' && c.position==='absolute' && parseFloat(c.width)>=24 && parseFloat(c.height)>=24;
      });
      const b=box(e);
      if (!expanded) add('alvo-minimo',e,24-Math.min(b.width,b.height),`Alvo de clique de ${round(b.width)}×${round(b.height)} px; o mínimo recomendado é 24×24 px (WCAG 2.2, 2.5.8).`,'candidato');
    }
    const page=backdrop(document.body);
    if (page && luminance(page)<.18 && !/dark/.test(computed(document.documentElement).colorScheme)) {
      flag('esquema-nativo',document.documentElement,null,'Tema escuro sem `color-scheme: dark` em html; barras de rolagem e controles nativos permanecem claros.','candidato');
    }
    for (const cohort of options.cohorts || []) {
      for (const e of document.querySelectorAll(cohort.selector)) {
        if (!visible(e)) continue;
        for (const dimension of ['width','height']) {
          const expected=cohort[dimension];
          if (Number.isFinite(expected) && expected>0) add('padrao-'+dimension,e,Math.abs(box(e)[dimension]-expected),`${cohort.name || 'Grupo'}: ${dimension} deve medir ${expected} px conforme o padrão informado.`,'requisito');
        }
      }
    }
    return findings;
  }

  // Contexto do produto: folhas de estilo, tokens, temas, tecnologias e componentes.
  function scanStyles() {
    const defs=new Map(), layers=new Set(), properties=new Set();
    let sheets=0, blocked=0;
    const define=(name,selector,condition,value)=>(defs.get(name) || defs.set(name,[]).get(name)).push({ selector, condition, value });
    const walk=(rules,condition)=>{
      for (const rule of rules) {
        const type=rule.constructor.name;
        if (type==='CSSPropertyRule') { properties.add(rule.name); continue; }
        if (type==='CSSLayerBlockRule' && rule.name) layers.add(rule.name);
        if (type==='CSSLayerStatementRule') for (const name of rule.nameList) layers.add(name);
        if (type==='CSSImportRule') {
          try { if (rule.styleSheet) walk(rule.styleSheet.cssRules,condition); } catch { blocked++; }
          continue;
        }
        if (rule.style && rule.selectorText) for (const name of rule.style) if (name.startsWith('--')) define(name,rule.selectorText,condition,rule.style.getPropertyValue(name).trim());
        if (rule.cssRules?.length) walk(rule.cssRules,rule.conditionText && /Media|Container|Supports/.test(type) ? (condition+' '+rule.conditionText).trim() : condition);
      }
    };
    for (const root of roots) for (const sheet of [...root.styleSheets,...(root.adoptedStyleSheets || [])]) {
      sheets++;
      try { walk(sheet.cssRules,''); } catch { blocked++; }
    }
    for (const [e,name] of [[document.documentElement,':root'],[document.body,'body']]) for (const property of e.style) if (property.startsWith('--')) define(property,name,'',e.style.getPropertyValue(property).trim());
    return { defs, layers, properties, sheets, blocked };
  }
  const splitSelectors=text=>{
    const parts=[];
    let depth=0, current='';
    for (const ch of text) {
      if ('(['.includes(ch)) depth++; else if (')]'.includes(ch)) depth--;
      if (ch===',' && !depth) { parts.push(current.trim()); current=''; } else current+=ch;
    }
    return [...parts,current.trim()].filter(Boolean);
  };
  const ROOT=/^(?::root|html|body|:host|\*|::?(?:before|after|backdrop)|\s)+$/;
  // Parte do seletor que alterna um tema na raiz: ".dark", '[data-theme="dark"]'. Null para escopos de componente.
  function themeKey(part) {
    const s=part.replace(/:(?:where|is)\(([^()]*)\)/g,'$1').replace(/^(?::root|html|body)\s*/,'').replace(/\s+(?:\*|body|:root)$/,'').trim();
    return /^(?:\.[\w-]+|\[[\w-]+(?:[~|^$*]?=(?:"[^"]*"|'[^']*'|[\w-]+))?\])+$/.test(s) ? s : null;
  }
  const KEYWORD=/^(inherit|initial|unset|revert|revert-layer|currentcolor|none|auto|normal)$/i;
  const COLOR_NAME=/color|bg|background|fg|foreground|text|border|primary|secondary|accent|muted|surface|rgb/i;
  const KINDS=[['radius',/radius|rounded/],['shadow',/shadow|elevation/],['typography',/font|text|leading|tracking|line-height|letter/],['motion',/ease|duration|transition|anim|delay/],['spacing',/spac|gap|size|width|height|inset|pad|margin|container|breakpoint/]];
  function tokenColor(name, value) {
    if (!value || KEYWORD.test(value)) return null;
    let css=value, format;
    if (/^[\d.]+(deg)?[ ,]+[\d.]+%[ ,]+[\d.]+%(\s*\/\s*[\d.]+%?)?$/.test(value)) { css=`hsl(${value})`; format='canais hsl'; }
    else if (/^\d{1,3}[ ,]+\d{1,3}[ ,]+\d{1,3}$/.test(value) && COLOR_NAME.test(name)) { css=`rgb(${value})`; format='canais rgb'; }
    else if (!CSS.supports('color',value)) return null;
    // O elemento de prova resolve var(), light-dark() e color-mix() no esquema de cor da página.
    probe.style.colorScheme=getComputedStyle(document.documentElement).colorScheme;
    probe.style.color='';
    probe.style.color=css;
    const resolved=getComputedStyle(probe).color;
    if (!probe.style.color || resolved===SENTINEL) return null;
    const c=rgba(resolved);
    return c && { hex:hex(c), format };
  }
  function readTokens(scan, used) {
    const bodyStyle=getComputedStyle(document.body);
    const out={ total:0, colors:[], radius:[], spacing:[], typography:[], shadow:[], motion:[], other:0, omitted:0, stylesheets:{ read:scan.sheets-scan.blocked, blocked:scan.blocked } };
    const index=new Map(), colors=[];
    for (const [name,defs] of scan.defs) {
      if (name.startsWith('--tw-')) continue;
      out.total++;
      let value=bodyStyle.getPropertyValue(name).trim();
      for (const d of value ? [] : defs) {
        try { value=getComputedStyle(document.querySelector(d.selector)).getPropertyValue(name).trim(); } catch {}
        if (value) break;
      }
      value ||= defs[0].value;
      const color=tokenColor(name,value);
      if (color) {
        (index.get(color.hex) || index.set(color.hex,[]).get(color.hex)).push(name);
        colors.push({ name, value, hex:color.hex, format:color.format, themed:new Set(defs.map(d=>d.selector+d.condition)).size>1, used:used.has(color.hex) });
        continue;
      }
      const list=out[KINDS.find(k=>k[1].test(name))?.[0]];
      if (!list) out.other++; else if (list.length<24) list.push({ name, value }); else out.omitted++;
    }
    // Em paletas extensas, primeiro o que a tela usa e o que muda por tema.
    const rank=c=>(c.used ? 2 : 0)+(c.themed ? 1 : 0);
    out.colors=colors.sort((a,b)=>rank(b)-rank(a)).slice(0,120);
    out.omitted+=Math.max(0,colors.length-120);
    return { tokens:out, index };
  }
  function readTheme(scan) {
    const base=new Set(), scopes=new Map(), media=new Map();
    let lightDark=false;
    for (const [name,defs] of scan.defs) for (const d of defs) {
      if (name.startsWith('--tw-')) continue;
      if (d.value.includes('light-dark(')) lightDark=true;
      const scheme=/prefers-color-scheme:\s*(dark|light)/.exec(d.condition);
      for (const part of splitSelectors(d.selector)) {
        if (scheme && /^(:root|html|body)/.test(part)) (media.get(scheme[1]) || media.set(scheme[1],new Map()).get(scheme[1])).set(name,d.value);
        else if (ROOT.test(part)) base.add(name);
        else {
          const key=themeKey(part);
          if (key) (scopes.get(key) || scopes.set(key,new Map()).get(key)).set(name,d.value);
        }
      }
    }
    const values=map=>Object.fromEntries([...map].slice(0,40));
    // Um tema é um seletor simples, com nome de tema, que redefine cores da raiz ou de outro tema.
    // Os demais são escopos de componente; os ativos só em um elemento interno ficam em `local`.
    const named=[...scopes].filter(([key])=>/^(?:\.[\w-]+|\[[^\]]+\])$/.test(key) && /dark|light|theme|mode|scheme|contrast/i.test(key));
    const themes=[], local=[];
    for (const [key,map] of named) {
      if ([...map].filter(([n,value])=>(base.has(n) || named.some(([other,tokens])=>other!==key && tokens.has(n))) && tokenColor(n,value)).length<2) continue;
      let target=null, active=false;
      try {
        const e=[document.documentElement,document.body].find(el=>el.matches(key)) || document.querySelector(key);
        active=!!e;
        const attribute=/^\[([\w-]+)/.exec(key)?.[1], holder=e || (attribute && document.querySelector('['+attribute+']'));
        if (holder) target=holder===document.documentElement ? 'html' : holder===document.body ? 'body' : selector(holder);
      } catch {}
      const value=/=["']?([^"'\]]+)/.exec(key)?.[1];
      (active && target!=='html' && target!=='body' ? local : themes).push({ name:value || key.replace(/^\./,''), selector:key, mechanism:key.startsWith('.') ? 'classe' : 'atributo', target, active, tokens:map.size, values:values(map) });
    }
    for (const [scheme,map] of media) themes.push({ name:scheme, selector:`@media (prefers-color-scheme: ${scheme})`, mechanism:'media query', target:'sistema', active:matchMedia(`(prefers-color-scheme: ${scheme})`).matches, tokens:map.size, values:values(map) });
    const storage=[];
    try {
      for (let i=0; i<localStorage.length; i++) {
        const key=localStorage.key(i), value=localStorage.getItem(key);
        if (/theme|color-?scheme|color-?mode|appearance|dark/i.test(key) && value.length<=40) storage.push({ key, value });
      }
    } catch {}
    const page=backdrop(document.body);
    return {
      appearance:page ? luminance(page)<.18 ? 'dark' : 'light' : null,
      colorScheme:getComputedStyle(document.documentElement).colorScheme,
      metaColorScheme:document.querySelector('meta[name="color-scheme"]')?.content || null,
      prefersColorScheme:matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      usesLightDark:lightDark,
      baseTokens:base.size,
      themes,
      local,
      active:themes.filter(t=>t.active).map(t=>t.name),
      storage
    };
  }
  function technologies(scan) {
    const found=[], w=window;
    const has=s=>{ try { return !!document.querySelector(s); } catch { return false; } };
    const global=name=>w[name]!==undefined && 'window.'+name;
    const token=prefix=>[...scan.defs.keys(),...scan.properties].some(n=>n.startsWith(prefix)) && 'tokens '+prefix+'*';
    const marker=(s,label)=>has(s) && (label || s);
    const containers=[...document.querySelectorAll('body > *,#root,#app,#__next')];
    const expando=prefix=>containers.some(e=>Object.keys(e).some(k=>k.startsWith(prefix)));
    const add=(name,category,evidence,version)=>{ if (evidence) found.push({ name, category, version:version ? String(version) : undefined, evidence }); };
    add('React','framework',(seen.react || expando('__reactContainer$') || expando('__reactFiber$')) && 'fibers nos nós do DOM',[...(w.__REACT_DEVTOOLS_GLOBAL_HOOK__?.renderers?.values?.() || [])][0]?.version);
    add('Next.js','framework',global('__NEXT_DATA__') || global('__next_f') || (w.next?.version && 'window.next') || marker('#__next'),w.next?.version);
    add('React Router / Remix','framework',global('__reactRouterContext') || global('__remixContext'));
    add('Gatsby','framework',marker('#___gatsby'));
    add('Vue','framework',(seen.vue || expando('__vue_app__') || has('[data-v-app]')) && 'aplicação montada no DOM',containers.find(e=>e.__vue_app__)?.__vue_app__.version || w.Vue?.version);
    add('Nuxt','framework',global('__NUXT__') || marker('#__nuxt'));
    add('Angular','framework',marker('[ng-version]'),document.querySelector('[ng-version]')?.getAttribute('ng-version'));
    add('Svelte','framework',marker('[class*="svelte-"]','classes svelte-*'));
    add('SvelteKit','framework',Object.keys(w).find(k=>k.startsWith('__sveltekit')));
    add('Solid','framework',global('_$HY') || marker('[data-hk]'));
    add('Astro','framework',marker('astro-island'));
    add('Qwik','framework',marker('[q\\:container]'));
    add('Lit','framework',global('litElementVersions'),w.litElementVersions?.[0]);
    add('Alpine.js','framework',global('Alpine') || marker('[x-data]'),w.Alpine?.version);
    add('htmx','framework',global('htmx') || marker('[hx-get],[hx-post],[hx-boost]','atributos hx-*'),w.htmx?.version);
    add('jQuery','biblioteca',w.jQuery?.fn?.jquery && 'window.jQuery',w.jQuery?.fn?.jquery);
    add('Vite (servidor de desenvolvimento)','build',marker('script[src*="/@vite/client"]','/@vite/client'));
    const generator=document.querySelector('meta[name="generator"]')?.content;
    add(generator,'gerador',generator && 'meta generator');
    add('Tailwind CSS','estilo',token('--tw-'),scan.layers.has('theme') && scan.layers.has('utilities') ? '4' : undefined);
    for (const [prefix,name] of Object.entries({ '--bs-':'Bootstrap', '--chakra-':'Chakra UI', '--mantine-':'Mantine', '--mui-':'MUI', '--ant-':'Ant Design', '--el-':'Element Plus', '--v-theme-':'Vuetify', '--ion-':'Ionic', '--sl-':'Shoelace', '--cds-':'Carbon', '--spectrum-':'Spectrum', '--md-sys-':'Material Web', '--bulma-':'Bulma' })) add(name,'estilo',token(prefix));
    const named=n=>found.some(f=>f.name===n);
    if (!named('MUI')) add('MUI','estilo',marker('[class*="Mui"]','classes Mui*'));
    if (!named('Ant Design')) add('Ant Design','estilo',marker('[class^="ant-"],[class*=" ant-"]','classes ant-*'));
    if (!named('Vuetify')) add('Vuetify','estilo',marker('.v-application'));
    const radix=marker('[data-radix-collection-item],[data-radix-popper-content-wrapper],[data-radix-scroll-area-viewport],[id^="radix-"]','atributos data-radix-*');
    add('Radix Primitives','componentes',radix);
    add('Radix Themes','componentes',marker('.radix-themes'));
    add('shadcn/ui (provável)','componentes',['--background','--foreground','--primary','--ring'].every(n=>scan.defs.has(n)) && (has('[data-slot]') || radix) && 'tokens --background, --foreground, --primary e --ring com data-slot ou Radix');
    add('Headless UI','componentes',marker('[data-headlessui-state]'));
    add('React Aria','componentes',marker('[data-rac]'));
    add('Ark UI / Zag','componentes',marker('[data-scope][data-part]'));
    add('daisyUI (provável)','componentes',scan.defs.has('--color-base-100') && has('[data-theme]') && 'tokens --color-base-* com data-theme');
    add('Emotion','estilo',marker('style[data-emotion]'));
    add('styled-components','estilo',marker('style[data-styled]'));
    add('Lucide','ícones',marker('svg.lucide'));
    add('Font Awesome','ícones',marker('svg.svg-inline--fa,i[class*="fa-"]','classes fa-*'));
    add('Tabler Icons','ícones',marker('svg.icon-tabler,svg.tabler-icon'));
    add('Material Icons','ícones',marker('.material-icons,[class*="material-symbols"]'));
    add('Bootstrap Icons','ícones',marker('i.bi'));
    add('GSAP','movimento',global('gsap'),w.gsap?.version);
    return found;
  }
  function inventory(m) {
    const names=new Map();
    for (const c of m.components) {
      if (!c.component) continue;
      const item=names.get(c.component.name) || names.set(c.component.name,{ name:c.component.name, count:0, via:c.component.via, source:c.component.source, selector:selector(c.element) }).get(c.component.name);
      item.count++;
    }
    const list=[...names.values()].sort((a,b)=>b.count-a.count);
    return { total:list.length, names:list.slice(0,40) };
  }
  function usage(m) {
    const colors=new Map(), count=()=>new Map();
    const type={ families:count(), sizes:count(), weights:count() }, radii=count();
    const bump=(map,key)=>map.set(key,(map.get(key) || 0)+1);
    const note=(value,role)=>{
      const c=rgba(value);
      if (!c || !c[3]) return;
      const key=hex(c), item=colors.get(key) || colors.set(key,{ hex:key, text:0, background:0, border:0 }).get(key);
      item[role]++;
    };
    for (const e of m.textParents) {
      const css=computed(e);
      note(css.color,'text');
      bump(type.families,css.fontFamily.split(',')[0].replace(/["']/g,'').trim());
      bump(type.sizes,css.fontSize);
      bump(type.weights,css.fontWeight);
    }
    for (const { element:e } of m.components) {
      const css=computed(e);
      note(css.backgroundColor,'background');
      if (parseFloat(css.borderTopWidth)>0 && css.borderTopStyle!=='none') note(css.borderTopColor,'border');
      const radius=css.borderTopLeftRadius.split(' ')[0];
      if (parseFloat(radius)) bump(radii,radius.endsWith('%') ? radius : parseFloat(radius)>=500 ? 'pílula' : round(parseFloat(radius))+'px');
    }
    const top=(map,limit=8)=>[...map].sort((a,b)=>b[1]-a[1]).slice(0,limit).map(([value,count])=>({ value, count }));
    const palette=[...colors.values()].sort((a,b)=>b.text+b.background+b.border-a.text-a.background-a.border).slice(0,24);
    return { used:new Set(colors.keys()), palette, typography:{ families:top(type.families), sizes:top(type.sizes), weights:top(type.weights) }, radii:top(radii) };
  }
  function context(m=measure()) {
    const scan=scanStyles(), { used, palette, typography, radii }=usage(m), { tokens, index }=readTokens(scan,used);
    for (const color of palette) color.tokens=(index.get(color.hex) || []).slice(0,3);
    const data={ version:VERSION, route:location.pathname, viewport:{ width:innerWidth, height:innerHeight, dpr:devicePixelRatio }, technologies:technologies(scan), theme:readTheme(scan), tokens, palette, typography, radii, components:inventory(m) };
    return { data, index };
  }

  function element(tag, attrs, text) {
    const e = document.createElementNS(svgNS, tag);
    for (const [key, value] of Object.entries(attrs)) e.setAttribute(key, String(value));
    if (text !== undefined) e.textContent = text;
    guides.append(e);
  }
  const red = '#ef4444';
  const line = (x1, y1, x2, y2, opacity = .65) => element('line', { x1, y1, x2, y2, stroke:red, 'stroke-width':1, opacity });
  function label(x, y, text) {
    element('rect', { x:x-4, y:y-12, width:text.length*6.8+8, height:18, rx:3, fill:'#991b1b', opacity:.94 });
    element('text', { x, y, fill:'#fff', 'font-family':'ui-monospace,monospace', 'font-size':11 }, text);
  }
  function outline(e, opacity = .3, solid = false) {
    const b = box(e);
    element('rect', { x:b.x, y:b.y, width:b.width, height:b.height, rx:3, fill:'none', stroke:red, 'stroke-width':1, 'stroke-dasharray':solid ? 'none' : '3 3', opacity });
  }
  function drawPart(part, opacity=.32) {
    const b=part.bounds;
    element('rect',{ x:b.x,y:b.y,width:b.width,height:b.height,fill:'none',stroke:red,'stroke-width':1,opacity });
    if (part.baselineApprox!==undefined && Number.isFinite(part.baselineApprox)) {
      element('line',{ x1:b.x,y1:part.baselineApprox,x2:b.right,y2:part.baselineApprox,stroke:red,'stroke-width':1,'stroke-dasharray':'2 2',opacity });
    }
  }
  function paint(m, findings) {
    guides.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
    m.controls.forEach(e => outline(e));
    m.components.filter(c => !m.controls.includes(c.element)).forEach(c => outline(c.element, .13));
    m.internals.forEach(c=>c.parts.forEach(p=>drawPart(p)));
    for (const f of findings) if (findingElement.get(f)!==document.documentElement) outline(findingElement.get(f), .85, true);
    if (m.sidebar) {
      const b = box(m.sidebar);
      line(b.x, 0, b.x, innerHeight, .35);
      line(b.right, 0, b.right, innerHeight, .35);
      line(b.x+16, 0, b.x+16, innerHeight, .45);
      if (m.labels.length) {
        const x = box(m.labels[0]).x;
        line(x, 88, x, innerHeight, .7);
        label(b.right+10, 108, `Títulos x=${round(x)} | Δ ${round(m.textDelta)} px`);
      }
      const rows=m.rows;
      if (rows.length) {
        const r = box(rows[0]);
        line(b.right+6, r.y, b.right+6, r.bottom);
        line(b.right+2, r.y, b.right+10, r.y);
        line(b.right+2, r.bottom, b.right+10, r.bottom);
        label(b.right+16, r.y+20, `${round(r.height)} px / linha`);
      }
      if (m.sidebarActions.length) {
        line(centerX(m.sidebarActions[0]), 90, centerX(m.sidebarActions[0]), innerHeight, .4);
        label(b.right+10, 172, `Ações Δ ${round(m.actionDelta)} px`);
      }
    }
    const rail=query(hooks.rail);
    if (rail && visible(rail)) line(centerX(rail), 0, centerX(rail), innerHeight, .45);
    if (m.composer && m.main) {
      const b = box(m.composer);
      outline(m.composer, .9);
      line(centerX(m.main), 0, centerX(m.main), innerHeight, .25);
      line(b.x, b.y-18, b.right, b.y-18);
      line(b.x, b.y-23, b.x, b.y-13);
      line(b.right, b.y-23, b.right, b.y-13);
      label(b.x+8, b.y-24, `${round(b.width)} px | centro Δ ${round(m.composerDelta)} px`);
      line(b.x, b.y-36, b.x, b.bottom+48, .45);
      line(b.right, b.y-36, b.right, b.bottom+48, .45);
      if (m.toolbar.length) {
        const y = centerY(m.toolbar[0]);
        line(b.x, y, b.right, y, .6);
        label(b.right+12, y+4, `Botões ${round(box(m.toolbar[0]).height)} px | Δ ${round(m.toolbarDelta)} px`);
      }
    }
    const selected = componentMap.get(hovered);
    if (!selected) return;
    outline(selected.element, 1);
    const b = box(selected.element);
    const inside=m.internals.find(c=>c.element===selected.element) || m.internals.find(c=>c.element.contains(selected.element));
    inside?.parts.forEach(p=>{
      drawPart(p,.95);
      line(p.bounds.x,midY(p.bounds),p.bounds.right,midY(p.bounds),.8);
    });
    const text = `N${selected.level} ${selected.type} | ${round(b.width)}×${round(b.height)} | x${round(b.x)} y${round(b.y)}`;
    label(Math.max(8, Math.min(innerWidth-text.length*6.8-16, b.right+12)), Math.max(20, Math.min(innerHeight-20, b.y+14)), text);
  }

  // Painel
  let tab='inspect', minimized=false, panelOn=options.panel!==false, userPlaced=false, drag=null;
  let last=null, bodyKey='', contextCache=null, sheetCount=-1;
  let stamp=0;
  const pageContext=()=>contextCache || (contextCache={ ...context(last.m), stamp:++stamp });
  const swatch=color=>h('span',{class:'sw',style:'background:'+color});
  function inspectView(m) {
    const c=componentMap.get(hovered);
    if (!c) return { key:['empty',m.components.length], build:()=>[
      h('p',{class:'empty',text:'Passe o ponteiro sobre a página para inspecionar um componente.'}),
      h('p',{class:'hint',text:`${m.components.length} componentes em níveis N0–N${Math.max(0,...m.components.map(x=>x.level))}.`})
    ] };
    const e=c.element, b=box(e), css=computed(e), rows=[], path=[];
    for (let p=c; p; p=componentMap.get(p.parent)) path.unshift(`N${p.level} ${p.type}`);
    const named=key=>key+(pageContext().index.get(key)?.length ? ' · '+pageContext().index.get(key)[0] : '');
    if (c.name && c.name!==c.type) rows.push(['Nome',c.name]);
    if (c.component) rows.push(['Componente',c.component.name+(c.component.source ? ' · '+c.component.source : '')]);
    rows.push(['Tamanho',`${round(b.width)} × ${round(b.height)} px`],['Posição',`x ${round(b.x)} · y ${round(b.y)}`]);
    const inside=m.internals.find(i=>i.element===e) || m.internals.find(i=>i.element.contains(e));
    const icon=inside?.parts.find(p=>p.type==='Ícone'), text=inside?.parts.find(p=>p.type.startsWith('Texto'));
    if (icon && text) rows.push(['Ícone e texto',`Δy ${round(Math.abs(midY(icon.bounds)-midY(text.bounds)))} px · gap ${round(text.bounds.x-icon.bounds.right)} px`]);
    if (text || m.textParents.has(e)) {
      const fg=rgba(css.color), bg=backdrop(e);
      if (fg) rows.push(['Texto',named(hex(fg)),hex(fg)]);
      rows.push(['Fonte',`${css.fontSize}/${css.lineHeight} · ${css.fontWeight} · ${css.fontFamily.split(',')[0].replace(/["']/g,'')}`]);
      if (fg && bg) rows.push(['Contraste',`${round(contrast(over(fg,bg),bg))}:1`]);
    }
    const bg=rgba(css.backgroundColor);
    if (bg && bg[3]) rows.push(['Fundo',named(hex(bg)),hex(bg)]);
    if (parseFloat(css.borderTopLeftRadius)) rows.push(['Raio',css.borderTopLeftRadius]);
    const pad=[css.paddingTop,css.paddingRight,css.paddingBottom,css.paddingLeft];
    if (pad.some(p=>parseFloat(p))) rows.push(['Padding',new Set(pad).size===1 ? pad[0] : pad[0]===pad[2] && pad[1]===pad[3] ? pad[0]+' '+pad[1] : pad.join(' ')]);
    rows.push(['Seletor',selector(e)]);
    return { key:[path,rows,!!pinned], build:()=>[
      h('p',{class:'path'},path.slice(0,-1).join(' › ')+(path.length>1 ? ' › ' : ''),h('b',{text:path.at(-1)})),
      h('dl',null,rows.map(([term,value,color])=>[h('dt',{text:term}),h('dd',{class:term==='Seletor' && 'mono'},color && swatch(color),value)])),
      pinned && h('div',{class:'row'},h('button',{class:'text',type:'button',text:'Soltar seleção',onclick:()=>api.select(null)}))
    ] };
  }
  function findingsView(findings) {
    if (!findings.length) return { key:['none'], build:()=>[h('p',{class:'empty',text:'Nenhum candidato automático. A composição ainda exige inspeção visual.'})] };
    return { key:[findings.map(f=>[f.rule,f.selector,f.deltaPx,f.message]),findings.map(f=>findingElement.get(f)===pinned)], build:()=>[
      h('ul',{class:'findings'},findings.map(f=>{
        const target=findingElement.get(f), current=target===pinned;
        return h('li',null,h('button',{type:'button','aria-current':String(current),title:f.selector,onclick:()=>{ pinned=current ? null : target; hovered=pinned; schedule(); }},
          h('span',{class:'dot','data-kind':f.confidence}),
          h('span',{class:'name',text:f.component || f.selector}),
          h('span',{class:'delta',text:f.deltaPx===null ? '' : f.deltaPx+' px'}),
          h('span',{class:'message',text:f.confidence[0].toUpperCase()+f.confidence.slice(1)+' · '+f.message})));
      }))
    ] };
  }
  function contextView() {
    const { data:c, stamp }=pageContext();
    return { key:[stamp], build:()=>{
      const t=c.theme, sections=[];
      const section=(title,note,...kids)=>sections.push(h('h3',null,title,note && h('small',{text:note})),...kids);
      section('Tecnologias',null,c.technologies.length
        ? h('div',{class:'chips'},c.technologies.map(x=>h('span',{class:'chip',title:x.evidence},x.name,x.version && h('small',{text:x.version}))))
        : h('p',{class:'empty',text:'Nenhuma tecnologia reconhecida pelas evidências do DOM.'}));
      const rows=[['Aparência',{ dark:'Escura', light:'Clara' }[t.appearance] || 'Indeterminada'],['color-scheme',t.colorScheme]];
      if (t.themes.length) rows.push(['Ativo',t.active.join(', ') || 'base'],['Disponíveis',t.themes.slice(0,6).map(x=>`${x.name} (${x.selector})`).join(', ')+(t.themes.length>6 ? ` e mais ${t.themes.length-6}` : '')]);
      if (t.local.length) rows.push(['Escopos locais',t.local.slice(0,6).map(x=>x.selector).join(', ')+(t.local.length>6 ? ` e mais ${t.local.length-6}` : '')]);
      if (t.usesLightDark) rows.push(['light-dark()','em uso nos tokens']);
      if (t.storage.length) rows.push(['Persistência',t.storage.map(s=>`${s.key} = ${s.value}`).join(', ')]);
      section('Tema',t.themes.length ? null : 'sem alternância detectada',h('dl',null,rows.map(([term,value])=>[h('dt',{text:term}),h('dd',{text:value})])));
      const colors=c.tokens.colors;
      if (colors.length) section('Tokens de cor',String(colors.length),h('div',{class:'tokens'},colors.slice(0,24).map(x=>h('div',{title:`${x.name}: ${x.value}`},swatch(x.hex),x.name))),colors.length>24 && h('p',{class:'hint',text:`Mais ${colors.length-24} em VisualInspector.context().`}));
      const loose=colors.length ? c.palette.filter(p=>!p.tokens.length) : c.palette;
      if (loose.length) section(colors.length ? 'Cores sem token' : 'Cores em uso',String(loose.length),h('div',{class:'chips'},loose.slice(0,12).map(p=>h('span',{class:'chip'},swatch(p.hex),p.hex,h('small',{text:'×'+(p.text+p.background+p.border)})))));
      if (c.typography.sizes.length) section('Tipografia',null,h('dl',null,[['Famílias',c.typography.families],['Tamanhos',c.typography.sizes],['Pesos',c.typography.weights]].map(([term,list])=>[h('dt',{text:term}),h('dd',{text:list.map(x=>x.value).join(', ')})])));
      if (c.components.names.length) section('Componentes',String(c.components.total),h('div',{class:'chips'},c.components.names.slice(0,16).map(n=>h('span',{class:'chip',title:[n.via,n.source].filter(Boolean).join(' · ')},n.name,h('small',{text:'×'+n.count})))));
      sections.push(h('div',{class:'row'},h('button',{class:'text',type:'button',text:'Atualizar',onclick:()=>{ contextCache=null; render(); }})));
      return sections;
    } };
  }
  function render() {
    const { m, findings }=last;
    summary.textContent=minimized ? `${findings.length} ${findings.length===1 ? 'achado' : 'achados'}` : '';
    badge.textContent=findings.length;
    badge.toggleAttribute('data-zero',!findings.length);
    if (minimized) return;
    const view=tab==='inspect' ? inspectView(m) : tab==='findings' ? findingsView(findings) : contextView();
    const key=tab+JSON.stringify(view.key);
    if (key===bodyKey) return;
    bodyKey=key;
    body.replaceChildren(...view.build().filter(Boolean));
  }
  function setTab(id, focus) {
    tab=id;
    tabButtons.forEach((button,i)=>{
      const on=TABS[i][0]===id;
      button.setAttribute('aria-selected',String(on));
      button.tabIndex=on ? 0 : -1;
      if (on && focus) button.focus();
    });
    body.setAttribute('aria-labelledby','vi-tab-'+id);
    bodyKey='';
    if (last) render();
  }
  function setMinimized(value) {
    minimized=value;
    panel.classList.toggle('minimized',minimized);
    fold.setAttribute('aria-expanded',String(!minimized));
    fold.setAttribute('aria-label',minimized ? 'Expandir painel' : 'Minimizar painel');
    fold.firstChild.firstChild.setAttribute('d',minimized ? 'M4 10l4-4 4 4' : 'M4 6l4 4 4-4');
    bodyKey='';
    schedule();
  }
  function place(x, y, user) {
    const b=host.getBoundingClientRect(), pad=16;
    host.style.left=Math.max(pad,Math.min(innerWidth-b.width-pad,x))+'px';
    host.style.top=Math.max(pad,Math.min(innerHeight-b.height-pad,y))+'px';
    if (user) userPlaced=true;
  }
  // Sem posição escolhida pelo usuário, o painel procura o canto que menos cobre controles e conteúdo.
  function dockPanel(m) {
    const b=host.getBoundingClientRect(), pad=16;
    if (userPlaced) return place(b.x,b.y);
    const right=innerWidth-b.width-pad, bottom=innerHeight-b.height-pad;
    const middle=Math.max(pad,(innerHeight-b.height)/2);
    const candidates=[{x:b.x,y:b.y},{x:right,y:bottom},{x:right,y:pad},{x:right,y:middle},{x:pad,y:middle}].map(c=>({x:Math.max(pad,Math.min(right,c.x)),y:Math.max(pad,Math.min(bottom,c.y))}));
    const obstacles=[...m.controls.map(e=>({rect:box(e),weight:4})),...m.components.filter(c=>c.element.matches('p,h1,h2,h3,img,table,pre')).map(c=>({rect:box(c.element),weight:1}))];
    const score=c=>obstacles.reduce((sum,o)=>sum+Math.max(0,Math.min(c.x+b.width,o.rect.right)-Math.max(c.x,o.rect.x))*Math.max(0,Math.min(c.y+b.height,o.rect.bottom)-Math.max(c.y,o.rect.y))*o.weight,0);
    candidates.sort((a,b)=>score(a)-score(b));
    place(candidates[0].x,candidates[0].y);
  }
  head.addEventListener('pointerdown',e=>{
    if (e.button!==0 || e.target.closest('button:not(.grip)')) return;
    const b=host.getBoundingClientRect();
    drag={ x:e.clientX-b.x, y:e.clientY-b.y };
    head.setPointerCapture(e.pointerId);
    panel.classList.add('dragging');
  });
  head.addEventListener('pointermove',e=>{ if (drag) place(e.clientX-drag.x,e.clientY-drag.y,true); });
  const endDrag=()=>{ drag=null; panel.classList.remove('dragging'); };
  head.addEventListener('pointerup',endDrag);
  head.addEventListener('pointercancel',endDrag);
  head.addEventListener('dblclick',e=>{ if (!e.target.closest('button:not(.grip)')) { userPlaced=false; schedule(); } });
  grip.addEventListener('keydown',e=>{
    const step=e.shiftKey ? 64 : 16, move={ ArrowLeft:[-step,0], ArrowRight:[step,0], ArrowUp:[0,-step], ArrowDown:[0,step] }[e.key];
    if (!move) return;
    e.preventDefault();
    const b=host.getBoundingClientRect();
    place(b.x+move[0],b.y+move[1],true);
  });
  tabs.addEventListener('keydown',e=>{
    const step={ ArrowRight:1, ArrowLeft:-1 }[e.key];
    if (!step) return;
    e.preventDefault();
    setTab(TABS[(TABS.findIndex(t=>t[0]===tab)+step+TABS.length)%TABS.length][0],true);
  });

  let guidesOn = true;
  let frame = 0;
  function draw() {
    frame = 0;
    if (!guidesOn && !panelOn) return;
    const m = measure(), findings = inspectRules(m);
    last = { m, findings };
    guides.replaceChildren();
    if (guidesOn) paint(m, findings);
    if (!panelOn) return;
    if (sheetCount!==document.styleSheets.length) { sheetCount=document.styleSheets.length; contextCache=null; }
    render();
    dockPanel(m);
  }
  function schedule() { if (!frame && (guidesOn || panelOn)) frame = requestAnimationFrame(draw); }
  function toggleGuides() {
    guidesOn = !guidesOn;
    guides.style.display = guidesOn ? '' : 'none';
    eye.setAttribute('aria-pressed', String(guidesOn));
    schedule();
    return guidesOn;
  }
  function togglePanel() {
    panelOn = !panelOn;
    host.style.display = panelOn ? '' : 'none';
    bodyKey='';
    schedule();
    return panelOn;
  }
  function toggle() {
    if (!style) return false;
    style.disabled = !style.disabled;
    compare.textContent = style.disabled ? 'Ver mock' : 'Ver original';
    schedule();
    return !style.disabled;
  }
  function inspect(event) {
    if (pinned) return;
    let e = event.target instanceof Element ? event.target : null;
    if (e && own(e)) return; // Sobre o painel, a seleção atual permanece legível.
    if (e?.shadowRoot) e = event.composedPath().find(n=>n instanceof Element) || e;
    while (e && !componentMap.has(e)) e = up(e);
    if (hovered !== e) { hovered=e; schedule(); }
  }
  window.addEventListener('resize', schedule);
  document.addEventListener('scroll', schedule, true);
  document.addEventListener('transitionend', schedule, true);
  document.addEventListener('pointerover', inspect, true);
  const resizeObserver = new ResizeObserver(schedule);
  resizeObserver.observe(host);
  for (const e of document.querySelectorAll(hooks.observe || 'main,aside,nav')) resizeObserver.observe(e);
  const mutationObserver = new MutationObserver(records=>{
    if (records.some(r=>!own(r.target))) schedule();
  });
  mutationObserver.observe(document.body, { childList:true, subtree:true,attributes:true,attributeFilter:['style','class','hidden','aria-expanded','aria-selected'] });
  // Trocas de tema acontecem em atributos de html e body.
  const themeObserver = new MutationObserver(()=>{ contextCache=null; bodyKey=''; schedule(); });
  for (const e of [document.documentElement,document.body]) themeObserver.observe(e,{ attributes:true });

  const rect=e=>{ const b=box(e); return { x:round(b.x), y:round(b.y), width:round(b.width), height:round(b.height) }; };
  const api = {
    version: VERSION, toggle, toggleGuides, togglePanel,
    movePanel(x, y) {
      userPlaced=x!==undefined;
      if (userPlaced) place(x,y,true); else schedule();
      return bounds(host.getBoundingClientRect());
    },
    select(path) {
      pinned=path ? find(path) : null;
      hovered=pinned;
      schedule();
      return pinned ? bounds(pinned.getBoundingClientRect()) : null;
    },
    audit() {
      const m=measure();
      return { status:'heuristic',coverage:{controls:m.controls.length,components:m.components.length,internalParts:m.internals.reduce((n,c)=>n+c.parts.length,0),shadowRoots:roots.length-1},tolerancePx:options.tolerancePx ?? 1, findings:inspectRules(m), typography:'Range mede caixas de texto; baseline e caixa de glifo são estimativas de TextMetrics.',
        internals:m.internals.map(c=>({ selector:selector(c.element), level:componentMap.get(c.element)?.level,
          parts:c.parts.map(p=>({ type:p.type,text:p.text,level:(componentMap.get(c.element)?.level||0)+1,inferred:!!p.inferred,bounds:p.bounds,baselineApprox:p.baselineApprox,inkTopApprox:p.inkTopApprox,inkBottomApprox:p.inkBottomApprox })) })) };
    },
    measurements() {
      const m = measure();
      return { controls:m.controls.length, textDelta:m.textDelta, toolbarDelta:m.toolbarDelta, actionDelta:m.actionDelta, composerDelta:m.composerDelta,
        components:m.components.map(c => ({ label:c.name, type:c.type, level:c.level, parent:c.parent ? componentMap.get(c.parent)?.type : null, component:c.component?.name, ...rect(c.element) })) };
    },
    context() { return context().data; },
    // Estado serializável para comparar antes e depois, inclusive entre recargas da página.
    snapshot() {
      const m=measure();
      return { version:VERSION, route:location.pathname, viewport:{ width:innerWidth, height:innerHeight, scrollX:round(scrollX), scrollY:round(scrollY) },
        components:m.components.map(c=>{
          const css=computed(c.element);
          return { key:selector(c.element), type:c.type, name:c.name, ...rect(c.element), style:{ color:css.color, background:css.backgroundColor, font:`${css.fontWeight} ${css.fontSize}/${css.lineHeight}`, radius:css.borderTopLeftRadius, padding:css.padding } };
        }),
        findings:inspectRules(m).map(f=>({ rule:f.rule, selector:f.selector, deltaPx:f.deltaPx, message:f.message })) };
    },
    diff(before, after=api.snapshot()) {
      const was=new Map(before.components.map(c=>[c.key,c])), now=new Map(after.components.map(c=>[c.key,c]));
      const out={ viewportChanged:JSON.stringify(before.viewport)!==JSON.stringify(after.viewport), added:[], removed:[], moved:[], resized:[], restyled:[], unchanged:0, findings:{ resolved:[], introduced:[], remaining:0 } };
      const brief=c=>({ key:c.key, type:c.type, name:c.name });
      for (const [key,c] of now) {
        const old=was.get(key);
        if (!old) { out.added.push({ ...brief(c), x:c.x, y:c.y, width:c.width, height:c.height }); continue; }
        const dx=round(c.x-old.x), dy=round(c.y-old.y), dw=round(c.width-old.width), dh=round(c.height-old.height);
        const changes=Object.fromEntries(Object.keys(c.style).filter(k=>c.style[k]!==old.style[k]).map(k=>[k,[old.style[k],c.style[k]]]));
        if (Math.abs(dx)>.5 || Math.abs(dy)>.5) out.moved.push({ ...brief(c), dx, dy });
        if (Math.abs(dw)>.5 || Math.abs(dh)>.5) out.resized.push({ ...brief(c), dw, dh });
        if (Object.keys(changes).length) out.restyled.push({ ...brief(c), changes });
        if (Math.abs(dx)<=.5 && Math.abs(dy)<=.5 && Math.abs(dw)<=.5 && Math.abs(dh)<=.5 && !Object.keys(changes).length) out.unchanged++;
      }
      for (const [key,c] of was) if (!now.has(key)) out.removed.push(brief(c));
      const id=f=>f.rule+' '+f.selector, ids=list=>new Set(list.map(id));
      out.findings.resolved=before.findings.filter(f=>!ids(after.findings).has(id(f)));
      out.findings.introduced=after.findings.filter(f=>!ids(before.findings).has(id(f)));
      out.findings.remaining=after.findings.length-out.findings.introduced.length;
      return out;
    },
    // Resumo em texto: uma chamada entrega contexto e achados sem inflar a conversa do agente.
    report({ maxFindings=20 }={}) {
      const m=measure(), c=context(m).data, findings=inspectRules(m), t=c.theme, lines=[];
      const list=(items,limit,format)=>items.slice(0,limit).map(format).join(', ')+(items.length>limit ? ` e mais ${items.length-limit}` : '');
      lines.push(`Interface Lens ${VERSION} · ${c.route} · ${c.viewport.width}×${c.viewport.height} @${c.viewport.dpr}x`);
      lines.push('Tecnologias: '+(list(c.technologies,20,x=>x.name+(x.version ? ' '+x.version : '')) || 'nenhuma reconhecida'));
      lines.push(`Tema: aparência ${t.appearance || 'indeterminada'} · color-scheme ${t.colorScheme}`+(t.themes.length ? ` · ativo ${t.active.join(', ') || 'base'} · disponíveis ${list(t.themes,6,x=>`${x.name} via ${x.mechanism} ${x.selector}${x.target ? ' em '+x.target : ''}`)}` : ' · sem alternância detectada')+(t.local.length ? ` · escopos locais ${list(t.local,6,x=>x.selector)}` : '')+(t.storage.length ? ` · persistência ${t.storage.map(s=>s.key+'='+s.value).join(', ')}` : ''));
      lines.push(`Tokens: ${c.tokens.total} (${c.tokens.colors.length} de cor)`+(c.tokens.stylesheets.blocked ? ` · ${c.tokens.stylesheets.blocked} folhas de outra origem sem leitura` : ''));
      if (c.tokens.colors.length) lines.push('Cores: '+list(c.tokens.colors,24,x=>`${x.name} ${x.hex}`));
      const loose=c.palette.filter(p=>!p.tokens.length);
      if (loose.length) lines.push((c.tokens.colors.length ? 'Cores em uso sem token: ' : 'Cores em uso: ')+list(loose,10,p=>`${p.hex} ×${p.text+p.background+p.border}`));
      if (c.typography.sizes.length) lines.push(`Tipografia: ${c.typography.families.map(x=>x.value).join(', ')} · tamanhos ${c.typography.sizes.map(x=>x.value).join(', ')} · pesos ${c.typography.weights.map(x=>x.value).join(', ')}`);
      if (c.radii.length) lines.push('Raios: '+c.radii.map(x=>x.value).join(', '));
      if (c.components.names.length) lines.push('Componentes: '+list(c.components.names,20,n=>`${n.name} ×${n.count}`));
      lines.push(`Cobertura: ${m.components.length} componentes, ${m.controls.length} controles, ${roots.length-1} shadow roots abertos, somente a área visível`);
      lines.push(`Achados (${findings.length}):`+(findings.length ? '' : ' nenhum candidato automático; a composição ainda exige inspeção visual'));
      for (const f of findings.slice(0,maxFindings)) lines.push(`- [${f.confidence}] ${f.rule} · ${f.selector}${f.deltaPx===null ? '' : ' · '+f.deltaPx+' px'} · ${f.message}`);
      if (findings.length>maxFindings) lines.push(`- e mais ${findings.length-maxFindings}; use VisualInspector.audit().findings`);
      return lines.join('\n');
    },
    remove() {
      resizeObserver.disconnect(); mutationObserver.disconnect(); themeObserver.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('scroll', schedule, true);
      document.removeEventListener('transitionend', schedule, true);
      document.removeEventListener('pointerover', inspect, true);
      cancelAnimationFrame(frame);
      guides.remove(); host.remove();
      if (window.VisualInspector===api) delete window.VisualInspector;
      options.onRemove?.();
    }
  };
  window.VisualInspector=api;
  if (!panelOn) host.style.display='none';
  setTab(tab);
  place(innerWidth,innerHeight);
  draw();
  return api;

}

window.VisualInspector = installVisualInspector();
