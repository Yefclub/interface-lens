/* Interface Lens: inspetor visual. Execute como Snippet ou injete em qualquer página.
 * Lê DOM, estilos, caixas de texto e ícones; não altera o conteúdo da página.
 * API: VisualInspector.report(), .context(), .audit(), .scan(), .measurements(), .snapshot(), .diff(), .refresh(),
 *      .select(), .toggleFocus(), .toggleGuides(), .togglePanel(), .movePanel(), .remove().
 */
function installVisualInspector(options) {
  'use strict';
  options = options || {};
  if (!document.body) {
    document.addEventListener('DOMContentLoaded',()=>installVisualInspector(options),{ once:true });
    return null;
  }
  window.VisualInspector?.remove();
  const VERSION='3.2.0';
  const style=options.mockStyle || null;
  const hooks=options.selectors || {};
  const nameAttributes=options.nameAttributes || [];
  const query=s=>s ? document.querySelector(s) : null;
  const svgNS='http://www.w3.org/2000/svg';
  const ACTION='button,a[href],summary,[role="button"],[role="link"],[role="menuitem"],[role="menuitemradio"]';
  const CONTROL=ACTION+',input:not([type="hidden"]),textarea,select,[role="textbox"],[role="checkbox"],[role="switch"],[role="slider"],[role="progressbar"],[role="menuitemcheckbox"],[role="tab"],[role="option"],[role="radio"],[role="combobox"],[role="searchbox"],[role="spinbutton"],[role="treeitem"],[contenteditable=""],[contenteditable="true"]';
  const FIELD='input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]),select,textarea';

  // As guias também ficam em shadow root, fora do alcance do CSS da página.
  const layer=document.createElement('div');
  layer.id='visual-inspector-guides';
  layer.setAttribute('aria-hidden','true');
  // contain isola o layout: redesenhar as guias não invalida o layout da página.
  layer.style.cssText='all:initial;display:block;position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:2147483000;contain:strict';
  // Dois canvas: a base (todos os contornos) só muda quando a página muda; a seleção acompanha o ponteiro.
  const baseCanvas=document.createElement('canvas'), selectionCanvas=document.createElement('canvas');
  for (const surface of [baseCanvas,selectionCanvas]) surface.style.cssText='position:absolute;inset:0;width:100%;height:100%';
  layer.attachShadow({mode:'open'}).append(baseCanvas,selectionCanvas);
  // Fora do body: bibliotecas de modal marcam os filhos do body como inertes e a hidratação estranha nós a mais ali.
  document.documentElement.append(layer);

  // O painel vive em shadow root: o CSS da página não o alcança e ele não vaza estilos.
  const host=document.createElement('div');
  host.id='visual-inspector-panel';
  host.style.cssText='all:initial;position:fixed;left:0;top:0;z-index:2147483001;contain:layout style';
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
  const css=`
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
    /* Altura fixa: o cabeçalho e as abas não mudam de lugar quando o conteúdo muda sob o ponteiro. */
    .body { display:flex; flex-direction:column; height:min(216px,calc(100vh - 160px)); overflow:auto; padding:4px 12px 12px; overscroll-behavior:contain; scrollbar-width:thin; }
    .body > * { flex:none; }
    .blank { margin:auto; max-width:250px; text-align:center; }
    .focus { display:flex; align-items:center; gap:8px; margin:0 8px 8px; padding:2px 2px 2px 10px; border-radius:10px; background:rgba(96,165,250,.12); color:#bfdbfe; }
    .focus span { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .focus .text { color:inherit; }
    .focus[hidden],.minimized .tabs,.minimized .focus,.minimized .body { display:none; }
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
  `;
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
  const focusText=h('span'), focusButton=h('button',{class:'text',type:'button',onclick:()=>toggleFocus()});
  const focusBar=h('div',{class:'focus',hidden:true},focusText,focusButton);
  const panel=h('section',{class:'panel','aria-label':'Interface Lens'},head,tabs,focusBar,body);
  // Elemento de prova para resolver tokens; a cor sentinela do pai denuncia valores que não são cor.
  const probe=h('i'), SENTINEL='rgb(1, 2, 3)';
  // Folha construída não depende de style-src no CSP da página; <style> fica como reserva.
  try {
    const sheet=new CSSStyleSheet();
    sheet.replaceSync(css);
    shadow.adoptedStyleSheets=[sheet];
  } catch { shadow.append(h('style',{text:css})); }
  shadow.append(panel,h('i',{hidden:true,style:'color:'+SENTINEL},probe));
  document.documentElement.append(host);

  let geometryCache=new WeakMap(), styleCache=new WeakMap(), roots=[document];
  const up=e=>e.parentElement || (e.parentNode instanceof ShadowRoot ? e.parentNode.host : null);
  const all=s=>roots.flatMap(r=>[...r.querySelectorAll(s)]);
  const own=e=>e===host || e===layer;
  function collectRoots() {
    roots=[document];
    for (let i=0; i<roots.length; i++) for (const e of roots[i].querySelectorAll('*')) if (e.shadowRoot && !own(e)) roots.push(e.shadowRoot);
  }
  // Elementos HTML que tocam a viewport. Uma subárvore fora da tela é descartada pela caixa do seu topo, o que mantém
  // a varredura proporcional ao que está visível; descendentes posicionados que escapam dessa caixa ficam de fora.
  function inView(root, out=[]) {
    for (const e of root.children) {
      if (own(e) || e.namespaceURI !== 'http://www.w3.org/1999/xhtml') continue;
      const b = box(e);
      if (b.width || b.height) { if (b.bottom < 0 || b.top > innerHeight || b.right < 0 || b.left > innerWidth) continue; }
      else if (computed(e).display === 'none') continue;
      out.push(e);
      inView(e,out);
      if (e.shadowRoot) inView(e.shadowRoot,out);
    }
    return out;
  }
  const box = e => {
    if (!geometryCache.has(e)) geometryCache.set(e,e.getBoundingClientRect());
    return geometryCache.get(e);
  };
  const computed = e => {
    if (!styleCache.has(e)) styleCache.set(e,getComputedStyle(e));
    return styleCache.get(e);
  };
  let clipCache=new WeakMap(), flowRegion=new WeakMap(), floatRegion=new WeakMap(), hiddenCache=new WeakMap(), viewRect=null;
  let shownCache=new WeakMap(), hitChain=new WeakSet(), modals=new Set(), topLayers=new Set(), covered=0;
  // Oculto por si ou por um ancestral. visibility é herdada e um descendante pode revertê-la, então só vale no próprio elemento.
  function hiddenChain(a) {
    if (!a) return false;
    if (!hiddenCache.has(a)) {
      const c = computed(a);
      hiddenCache.set(a,c.opacity === '0' || c.display === 'none' || c.clipPath === 'inset(50%)' || c.clip === 'rect(0px, 0px, 0px, 0px)' || hiddenChain(up(a)));
    }
    return hiddenCache.get(a);
  }
  // Região em que um descendante de `a` pode aparecer, calculada uma vez por elemento.
  // Posicionados escapam do overflow: fixed de todos os ancestrais; absolute (floating) dos ancestrais estáticos.
  // O overflow de html e body vale para a viewport, não para a caixa deles.
  function region(a, floating) {
    if (!a) return viewRect;
    const cache = floating ? floatRegion : flowRegion;
    if (cache.has(a)) return cache.get(a);
    const c = computed(a), anchored = c.position !== 'static' || c.transform !== 'none';
    let out = c.position === 'fixed' ? viewRect : region(up(a),c.position === 'absolute' ? true : anchored ? false : floating);
    if ((anchored || !floating) && a !== document.body && a !== document.documentElement) {
      const x = /auto|scroll|hidden|clip/.test(c.overflowX), y = /auto|scroll|hidden|clip/.test(c.overflowY);
      if (x || y) {
        const r = box(a);
        out = { left:x ? Math.max(out.left,r.left) : out.left, right:x ? Math.min(out.right,r.right) : out.right, top:y ? Math.max(out.top,r.top) : out.top, bottom:y ? Math.min(out.bottom,r.bottom) : out.bottom };
      }
    }
    cache.set(a,out);
    return out;
  }
  // Parte do elemento que aparece na viewport depois dos recortes dos ancestrais; null quando nada aparece.
  function clipRect(e) {
    if (clipCache.has(e)) return clipCache.get(e);
    const b = box(e);
    let out = null;
    if (b.width > 0 && b.height > 0 && b.right > 0 && b.x < innerWidth && b.bottom > 0 && b.y < innerHeight) {
      const c = computed(e);
      if (c.visibility !== 'hidden' && !hiddenChain(e)) {
        const r = c.position === 'fixed' ? viewRect : region(up(e),c.position === 'absolute');
        const left = Math.max(r.left,b.left), right = Math.min(r.right,b.right), top = Math.max(r.top,b.top), bottom = Math.min(r.bottom,b.bottom);
        if (right > left && bottom > top) out = { left, right, top, bottom };
      }
    }
    clipCache.set(e,out);
    return out;
  }
  const visible = e => !!clipRect(e);
  // Modo foco: só entra na inspeção o que a aplicação está mostrando por cima.
  let focusOn = options.focus !== false;
  const within = (inner, outer) => { for (let n=inner; n; n=up(n)) if (n===outer) return true; return false; };
  // Uma camada alheia tira o elemento do foco quando pinta algo sobre ele: fundo, imagem ou desfoque.
  // Sobreposições transparentes, como o pseudo-elemento de um card clicável, não escondem nada.
  function blocks(n, x, y) {
    if (modals.has(n)) return true;
    const b = box(n);
    if (x < b.left || x > b.right || y < b.top || y > b.bottom) return false;
    if (/^(img|video|canvas|iframe|picture)$/.test(n.localName)) return true;
    const c = computed(n), bg = rgba(c.backgroundColor);
    return !!(bg && bg[3] >= .1) || c.backgroundImage !== 'none' || (c.backdropFilter || 'none') !== 'none';
  }
  // Sobe de `from` até o filho de um ancestral comum (`stop`) e devolve esse ramo com o z-index que vale para ele:
  // o do posicionado mais externo no caminho, já que ancestrais estáticos não criam contexto de empilhamento.
  function climb(from, stop) {
    let z = -.5;
    for (let a=from; a; a=up(a)) {
      const c = computed(a);
      if (c.position !== 'static') z = c.zIndex === 'auto' ? 0 : parseInt(c.zIndex) || 0;
      if (stop(up(a))) return { branch:a, common:up(a), z };
    }
    return null;
  }
  // Ordem de pintura aproximada entre ramos irmãos: top layer, depois z-index dos posicionados, depois ordem no documento.
  // Só é usada onde o teste de ponto não alcança: elementos com pointer-events: none e modais declarados.
  function above(n, e) {
    for (let a=n; a; a=up(a)) if (topLayers.has(a)) return !within(e,a);
    const chain = new Set();
    for (let a=e; a; a=up(a)) chain.add(a);
    const top = climb(n,a=>chain.has(a));
    if (!top) return true;
    const base = climb(e,a=>a===top.common);
    return top.z !== base.z ? top.z > base.z : !!(base.branch.compareDocumentPosition(top.branch) & Node.DOCUMENT_POSITION_FOLLOWING);
  }
  // Vizinho estático do mesmo fluxo e sem fundo não é uma camada sobre o alvo: é conteúdo que invade a caixa.
  function sameFlow(hit, e) {
    for (let a=hit; a; a=up(a)) {
      if (within(e,a)) return true;
      if (computed(a).position !== 'static') return false;
    }
    return false;
  }
  const POINTS = [[.5,.5],[.15,.2],[.85,.8],[.15,.8],[.85,.2]];
  const topAt = (root, x, y) => {
    const hit = root.elementFromPoint(x,y);
    return hit && own(hit) ? root.elementsFromPoint(x,y).find(n=>!own(n)) || null : hit;
  };
  // Modal declarado (<dialog> modal, aria-modal ou alertdialog) que está por cima: a aplicação diz o que quer mostrar,
  // mesmo sem pano de fundo pintado. modalChain guarda, para cada ancestral do modal, o ramo que leva até ele.
  let modalRoot=null, modalChain=new Map();
  function findModal() {
    modalRoot=null; modalChain=new Map();
    if (!focusOn) return;
    let list=[];
    try { list=all(':modal,[aria-modal="true"],[role="alertdialog"]'); } catch { list=all('[aria-modal="true"],[role="alertdialog"]'); }
    modalRoot=list.reverse().find(d=>{
      const c=!own(d) && clipRect(d);
      return c && POINTS.some(([fx,fy])=>{ const hit=topAt(d.getRootNode(),c.left+(c.right-c.left)*fx,c.top+(c.bottom-c.top)*fy); return hit && within(hit,d); });
    }) || null;
    let z=-.5;
    for (let a=modalRoot; a && up(a); a=up(a)) {
      const c=computed(a);
      if (c.position!=='static') z=c.zIndex==='auto' ? 0 : parseInt(c.zIndex) || 0;
      modalChain.set(up(a),{ branch:a, z });
    }
  }
  // Fora do modal declarado: nem dentro dele, nem em uma camada que pinta por cima (menu ou seletor aberto a partir dele).
  function outsideModal(e) {
    if (!modalRoot || within(e,modalRoot)) return false;
    for (let a=e; a; a=up(a)) if (topLayers.has(a) && a!==modalRoot) return false;
    if (modals.has(modalRoot)) return true;
    const mine=climb(e,a=>modalChain.has(a));
    if (!mine) return true;
    const modal=modalChain.get(mine.common);
    if (mine.branch===modal.branch) return true;
    return mine.z!==modal.z ? mine.z<modal.z : !(modal.branch.compareDocumentPosition(mine.branch) & Node.DOCUMENT_POSITION_FOLLOWING);
  }
  function shown(e) {
    if (shownCache.has(e)) return shownCache.get(e);
    const c = clipRect(e);
    let out = !!c;
    if (c && focusOn && outsideModal(e)) { out = false; covered++; }
    // Um teste de ponto que acerta um descendante já prova o ancestral: hitChain evita repetir o teste.
    else if (c && focusOn && !hitChain.has(e)) {
      const root = e.getRootNode(), style = computed(e), passive = style.pointerEvents === 'none';
      // Texto em linha que quebra tem a caixa envolvente maior que o desenho; o primeiro fragmento é o ponto seguro.
      const first = style.display === 'inline' ? e.getClientRects()[0] : null;
      const left = first ? Math.max(c.left,first.left) : c.left, right = first ? Math.min(c.right,first.right) : c.right;
      const top = first ? Math.max(c.top,first.top) : c.top, bottom = first ? Math.min(c.bottom,first.bottom) : c.bottom;
      // Uma camada que cobre o elemento inteiro decide no primeiro ponto; não é preciso testar os outros.
      let sealed = false;
      const hides = (n,x,y) => {
        if (!blocks(n,x,y) || passive && !above(n,e)) return false;
        const b = box(n);
        sealed = modals.has(n) || b.left <= c.left && b.right >= c.right && b.top <= c.top && b.bottom >= c.bottom;
        return true;
      };
      out = right <= left || bottom <= top || POINTS.some(([fx,fy]) => {
        if (sealed) return false;
        const x = left+(right-left)*fx, y = top+(bottom-top)*fy, hit = root.elementFromPoint(x,y);
        if (!hit) return true;
        if (!own(hit)) {
          if (within(hit,e)) { for (let a=hit; a && !hitChain.has(a); a=up(a)) hitChain.add(a); return true; }
          if (within(e,hit)) return true;
          if (hides(hit,x,y)) return false;
          if (sameFlow(hit,e)) return true;
        }
        for (const n of root.elementsFromPoint(x,y)) {
          if (own(n)) continue;
          if (within(n,e) || within(e,n)) return true;
          if (hides(n,x,y)) return false;
        }
        return true;
      });
      if (!out) covered++;
    }
    shownCache.set(e,out);
    return out;
  }
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
    const hx=/^#([0-9a-f]{3,8})$/i.exec(value || '');
    if (m) out=[+m[1],+m[2],+m[3],m[4]===undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4])/100 : +m[4]];
    else if (hx && hx[1].length!==5 && hx[1].length!==7) {
      const d=hx[1].length<5 ? [...hx[1]].map(ch=>ch+ch).join('') : hx[1];
      out=[0,2,4].map(i=>parseInt(d.slice(i,i+2),16)).concat(d.length===8 ? parseInt(d.slice(6),16)/255 : 1);
    }
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
  let backdropCache=new WeakMap();
  function backdrop(e) {
    if (!backdropCache.has(e)) backdropCache.set(e,readBackdrop(e));
    return backdropCache.get(e);
  }
  function readBackdrop(e) {
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
  // Frameworks de utilitários declaram sombras transparentes em todo elemento; só conta a que desenha algo.
  const castsShadow=c=>c.boxShadow!=='none' && c.boxShadow.split(/,(?![^(]*\))/).some(part=>{
    const color=rgba((/(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\([^)]*\)|#[0-9a-f]+/i.exec(part) || [])[0]);
    return (!color || color[3]>.02) && (part.replace(/[a-z-]+\([^)]*\)/gi,'').match(/-?[\d.]+px/g) || []).some(n=>parseFloat(n)!==0);
  });
  const bordered=c=>parseFloat(c.borderTopWidth)>0 && c.borderTopStyle!=='none' && (rgba(c.borderTopColor)?.[3] ?? 1)>0;
  const surface=e=>{
    const c=computed(e), bg=rgba(c.backgroundColor);
    return !!(bg && bg[3]) || bordered(c) || castsShadow(c);
  };
  // Contêiner sem semântica que pinta uma caixa visível: card, painel, barra. Fundos iguais ao que está atrás não contam.
  function paintsBox(e, minWidth=48, minHeight=32) {
    const b=box(e);
    if (b.width<minWidth || b.height<minHeight || b.width>=innerWidth*.95 && b.height>=innerHeight*.95) return false;
    const c=computed(e);
    if (bordered(c) || castsShadow(c) || c.backgroundImage!=='none') return true;
    const bg=rgba(c.backgroundColor);
    if (!bg || bg[3]<.05) return false;
    const behind=up(e) ? backdrop(up(e)) : null;
    return !behind || hex(over(bg,behind))!==hex(behind);
  }
  const CHARTS=[['svg.recharts-surface','Recharts'],['svg.apexcharts-svg','ApexCharts'],['svg.highcharts-root','Highcharts'],['[_echarts_instance_] canvas,[_echarts_instance_] svg','ECharts'],['.js-plotly-plot svg.main-svg','Plotly']];
  const chartOf=e=>CHARTS.find(([selector])=>e.matches(selector))?.[1] || (e.localName==='canvas' && window.Chart?.getChart?.(e) ? 'Chart.js' : '');

  // Ids gerados em tempo de execução (useId do React, Radix, hashes) mudam a cada render e não servem de seletor.
  const stableId=e=>e.id && !/[:«»]|^_|_R_|^radix-|[0-9a-f]{8,}|\d{5,}/.test(e.id);
  // Seletor único no seu root; elementos em shadow root usam "host >>> interno".
  function selector(e) {
    const root=e.getRootNode(), tag=e.localName;
    const unique=s=>{ try { return root.querySelectorAll(s).length===1; } catch { return false; } };
    const scope=hooks.scope && e.closest(hooks.scope) ? hooks.scope+' ' : '';
    const candidates=[];
    for (const a of ['aria-label','data-testid',...nameAttributes]) if (e.getAttribute(a)) candidates.push(scope+tag+'['+a+'='+JSON.stringify(e.getAttribute(a))+']');
    if (stableId(e)) candidates.push('#'+CSS.escape(e.id));
    if (e.classList.length) candidates.push(scope+tag+[...e.classList].slice(0,2).map(c=>'.'+CSS.escape(c)).join(''));
    let found=candidates.find(unique);
    if (!found) {
      const path=[];
      for (let a=e; a; a=a.parentElement) {
        if (stableId(a) && unique('#'+CSS.escape(a.id))) { path.unshift('#'+CSS.escape(a.id)); break; }
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
  let lastFont='';
  function fontMetrics(text, css) {
    const font = `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
    if (font !== lastFont) textContext.font = lastFont = font;
    return textContext.measureText(text);
  }
  function clipText(rect, parent) {
    const r=region(parent,false);
    const left=Math.max(r.left,rect.x), right=Math.min(r.right,rect.right), top=Math.max(r.top,rect.y), bottom=Math.min(r.bottom,rect.bottom);
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
      if (!text || !parent || (!content && owner(parent)!==control) || parent.closest('.sr-only') || !visible(parent)) continue;
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
  const GENERIC=/^(.{1,2}$|Primitive\.|Styled\(|styled\.|Slot|SlotClone|Fragment|Suspense|ForwardRef|Memo|Anonymous|Presence|Portal|_c\d*$)|(Provider|Context|Consumer)$/;
  const cleanName=name=>{
    name=(name || '').replace(/^(?:ForwardRef|Memo|WithStyles|Observer|Connect)\((.+)\)$/,'$1');
    return !name || GENERIC.test(name) || name.length===3 && !/^([A-Z][a-z]{2}|[A-Z]{3})$/.test(name) ? '' : name;
  };
  const seen={react:false,vue:false};
  function componentName(e) {
    const key=Object.keys(e).find(k=>k.startsWith('__reactFiber$'));
    if (key) {
      seen.react=true;
      const owners=[];
      let source;
      for (let f=e[key]?.return; f && typeof f.type!=='string' && owners.length<4; f=f.return) {
        const t=f.type, name=cleanName(typeof t==='function' ? t.displayName || t.name : t && typeof t==='object' ? t.displayName || t.render?.displayName || t.render?.name || t.type?.displayName || t.type?.name : '');
        if (!name) continue;
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

  // Conteúdo distribuído por <slot> não é descendente do controle no shadow root, mas é o que ele mostra.
  const slotted=e=>[...e.querySelectorAll('slot')].flatMap(slot=>slot.assignedNodes({ flatten:true })).filter(n=>n.nodeType===1 || n.textContent.trim());
  const labelOf=e=>e.getAttribute('aria-label') || (e.getAttribute('aria-labelledby') || '').split(/\s+/).map(id=>id && e.getRootNode().getElementById?.(id)?.textContent.trim()).filter(Boolean).join(' ') || e.querySelector('h1,h2,h3,[role="heading"]')?.textContent.trim() || '';
  // O papel declarado vale mais que a tag: um <ul role="menu"> é um menu.
  const ROLES={ button:'Botão', link:'Link', textbox:'Campo', searchbox:'Campo', spinbutton:'Campo', combobox:'Seletor', checkbox:'Caixa de seleção', radio:'Opção', switch:'Chave', slider:'Slider', progressbar:'Progresso', menuitem:'Item de menu', menuitemradio:'Opção de menu', menuitemcheckbox:'Opção de menu', tab:'Aba', option:'Opção', treeitem:'Item',
    dialog:'Diálogo', alertdialog:'Diálogo', group:'Grupo', article:'Artigo', menu:'Menu', menubar:'Menu', listbox:'Lista', list:'Lista', tree:'Árvore', grid:'Tabela', tablist:'Abas', tabpanel:'Painel', toolbar:'Barra de ferramentas', search:'Busca', navigation:'Navegação', banner:'Cabeçalho', main:'Conteúdo', complementary:'Barra lateral', contentinfo:'Rodapé', region:'Seção', alert:'Alerta', status:'Status', tooltip:'Dica', note:'Nota' };
  const TAGS={ NAV:'Navegação', MAIN:'Conteúdo', ASIDE:'Barra lateral', HEADER:'Cabeçalho', FOOTER:'Rodapé', BUTTON:'Botão', A:'Link', SUMMARY:'Ação expansível', DETAILS:'Detalhes', LABEL:'Rótulo', P:'Parágrafo', UL:'Lista', OL:'Lista', DL:'Lista', LI:'Item', PRE:'Código', BLOCKQUOTE:'Citação', FIGURE:'Figura', TABLE:'Tabela', TH:'Célula', TD:'Célula', ARTICLE:'Artigo',
    H1:'Título', H2:'Título', H3:'Título', H4:'Título', H5:'Título', H6:'Título', INPUT:'Campo', TEXTAREA:'Campo', SELECT:'Seletor', SECTION:'Seção', FORM:'Formulário', FIELDSET:'Grupo de campos', DIALOG:'Diálogo', PROGRESS:'Progresso', METER:'Medidor', SVG:'Ícone', IMG:'Imagem', VIDEO:'Vídeo', AUDIO:'Áudio', CANVAS:'Canvas', IFRAME:'Frame' };
  let componentMap = new Map();
  let hovered = null;
  let pinned = null;
  function identify(controls) {
    const textParents=new Set();
    for (const root of roots) {
      const walker=document.createTreeWalker(root===document ? document.body : root,NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const p=walker.currentNode.parentElement;
        if (!p || p.children.length || own(p) || p.closest('script,style,noscript,svg,.sr-only')) continue;
        if (walker.currentNode.textContent.trim() && shown(p)) textParents.add(p);
      }
    }
    const groups = all('nav,main,aside,section,header,footer,form,fieldset,label,p,ul,ol,dl,li,pre,blockquote,figure,details,table,th,td,article,dialog,h1,h2,h3,h4,h5,h6,progress,meter,video,audio,canvas,iframe,svg,img,'+Object.keys(ROLES).map(role=>`[role="${role}"]`).join(',')+(hooks.components ? ','+hooks.components : ''));
    for (const icon of groups.filter(e=>e.matches('svg,img'))) {
      const parent=icon.parentElement;
      if (parent && parent.children.length===1 && !parent.textContent.trim() && /flex|grid/.test(computed(parent).display)) groups.push(parent);
    }
    const nodes = [...new Set([...groups, ...controls, ...textParents])].filter(e => !own(e) && shown(e));
    // Cards e painéis costumam ser div sem semântica: entram os ancestrais do que já foi identificado que pintam uma caixa.
    const tested = new Set(nodes), surfaces = new Set();
    for (const e of [...nodes]) for (let a=up(e); a && a!==document.body && a!==document.documentElement && !tested.has(a); a=up(a)) {
      tested.add(a);
      const only=a.children.length===1 && tested.has(a.firstElementChild) ? box(a.firstElementChild) : null;
      if (only && Math.abs(only.width-box(a).width)<=1 && Math.abs(only.height-box(a).height)<=1) continue;
      if (!own(a) && paintsBox(a) && shown(a)) { surfaces.add(a); nodes.push(a); }
    }
    // O que sobra não tem texto nem controle dentro: barras, avatares, esqueletos e divisórias que só pintam uma caixa,
    // e elementos que respondem ao clique sem serem botão nem link.
    const blocks = new Set(), clickables = new Set();
    for (const e of inView(document.body)) {
      const css = computed(e);
      if (css.cursor === 'pointer' && up(e) && computed(up(e)).cursor !== 'pointer' && !e.closest(CONTROL+',label,summary') && !e.querySelector(CONTROL+',label') && shown(e)) {
        clickables.add(e);
        if (!tested.has(e)) nodes.push(e);
      } else if (!tested.has(e) && (css.backgroundColor !== 'rgba(0, 0, 0, 0)' || css.backgroundImage !== 'none' || parseFloat(css.borderTopWidth) > 0) && paintsBox(e,8,8) && shown(e)) { blocks.add(e); nodes.push(e); }
    }
    const nodeSet = new Set(nodes);
    nodes.length = 0; nodes.push(...nodeSet);
    const components = nodes.map(e => {
      let parent = up(e);
      while (parent && !nodeSet.has(parent)) parent = up(parent);
      let level = 0;
      for (let a=parent; a; a=up(a)) if (nodeSet.has(a)) level++;
      const custom=options.describe?.(e) || {};
      const role=e.getAttribute('role');
      const type=custom.type || ROLES[role] || TAGS[e.tagName.toUpperCase()] || (clickables.has(e) ? 'Clicável' : textParents.has(e) ? 'Texto' : surfaces.has(e) ? 'Superfície' : blocks.has(e) ? 'Bloco' : 'Grupo');
      const chart=chartOf(e), large=e.localName==='svg' && Math.max(box(e).width,box(e).height)>48;
      const kind=custom.type || (chart ? 'Gráfico' : large ? 'Imagem vetorial' : type);
      const name=custom.name || ['aria-label',...nameAttributes,'alt','title'].map(a=>e.getAttribute(a)).find(Boolean) || (['Botão','Linha','Título','Texto','Link'].includes(kind) ? e.textContent.trim().slice(0,64) : surfaces.has(e) && (e.querySelector('h1,h2,h3,h4,h5,h6,[role="heading"]')?.textContent || e.textContent).trim().replace(/\s+/g,' ').slice(0,40) || chart || kind);
      return { element:e, parent, level, type:kind, name, component:componentName(e) };
    });
    // Card: superfície com borda, raio ou sombra que agrupa mais de um componente.
    const children=new Map();
    for (const c of components) if (c.parent) children.set(c.parent,(children.get(c.parent) || 0)+1);
    for (const c of components) {
      if (c.type!=='Superfície' || (children.get(c.element) || 0)<2) continue;
      const css=computed(c.element);
      if (bordered(css) || castsShadow(css) || parseFloat(css.borderTopLeftRadius)) c.type='Card';
    }
    componentMap = new Map(components.map(c => [c.element,c]));
    return { components, textParents, clickables };
  }
  function measure() {
    // Uma leitura por elemento em cada snapshot; nunca reaproveitar após edição.
    geometryCache=new WeakMap();styleCache=new WeakMap();clipCache=new WeakMap();flowRegion=new WeakMap();floatRegion=new WeakMap();hiddenCache=new WeakMap();backdropCache=new WeakMap();shownCache=new WeakMap();hitChain=new WeakSet();covered=0;
    viewRect={ left:0, right:innerWidth, top:0, bottom:innerHeight };
    collectRoots();
    try { modals=new Set(all(':modal')); topLayers=new Set(all(':modal,:popover-open').filter(e=>!own(e))); } catch { modals=new Set(); topLayers=new Set(); }
    findModal();
    const sidebar=query(hooks.sidebar);
    const composer=query(hooks.composer);
    const main=query(hooks.main || 'main');
    const rows=sidebar && hooks.rows ? [...sidebar.querySelectorAll(hooks.rows)].filter(visible) : [];
    const labels=rows.map(row=>options.labelForRow ? options.labelForRow(row) : hooks.label ? row.querySelector(hooks.label) : null).filter(Boolean);
    const toolbarRoot=options.toolbarRoot?.(composer) || query(hooks.toolbar);
    const toolbar=toolbarRoot ? [...toolbarRoot.querySelectorAll('button')].filter(e=>visible(e) && box(e).y>=box(toolbarRoot).y-1 && box(e).bottom<=box(toolbarRoot).bottom+1) : [];
    const controls = all(CONTROL).filter(e => !own(e) && shown(e));
    const sidebarActions = sidebar && hooks.actions ? [...sidebar.querySelectorAll(hooks.actions)].filter(visible) : [];
    const { components, textParents, clickables } = identify(controls);
    const internals = controls.filter(e=>e.matches(ACTION)).map(e=>({ element:e, parts:partsFor(e) }));
    for (const c of components.filter(c=>c.type==='Texto' || c.element.matches('p,h1,h2,h3,th,td,label'))) internals.push({element:c.element,parts:partsFor(c.element,true)});
    const labelLevels=new Map();
    for (const e of labels) {
      const level=componentMap.get(hooks.rows ? e.closest(hooks.rows) : e)?.level || 0;
      if (!labelLevels.has(level)) labelLevels.set(level,[]);
      labelLevels.get(level).push(box(e).x);
    }
    // Camada em foco: o diálogo visível mais ao fim do documento, quando ele cobre o que está atrás.
    let dialog=null;
    try { dialog=modalRoot || all('[role="dialog"]').filter(e=>!own(e) && shown(e)).at(-1) || null; } catch {}
    const modal=!!dialog && dialog===modalRoot;
    // Um banner com role="dialog" não é a camada em foco: ou o diálogo se declara modal, ou cobre boa parte da tela.
    const focus={ on:focusOn, covered, layer:dialog && covered && (modal || covered>=8 && covered>=components.length/3) ? { selector:selector(dialog), name:labelOf(dialog).slice(0,64), modal } : null };
    const frames=all('iframe').filter(e=>{ try { return visible(e) && e.contentDocument?.body?.childElementCount>0; } catch { return false; } }).length;
    // Canvas de aplicação é o que recebe o ponteiro na maior parte da própria área; o decorativo fica atrás do conteúdo.
    const canvas=all('canvas').some(e=>{
      const c=clipRect(e);
      return c && (c.right-c.left)*(c.bottom-c.top)>innerWidth*innerHeight*.5 && POINTS.filter(([fx,fy])=>e.getRootNode().elementFromPoint(c.left+(c.right-c.left)*fx,c.top+(c.bottom-c.top)*fy)===e).length>=3;
    });
    return {
      focus, frames, canvas, clickables,
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
  const CATEGORY={};
  for (const [category,rules] of Object.entries({
    alinhamento:'icone-texto-y icone-botao-x icone-botao-y conteudo-botao-x icone-slot-x icone-slot-y componente-linha-y coluna-titulos centro-toolbar coluna-acoes',
    consistência:'ritmo-gap borda-inicial dimensao-irmaos raio-concentrico quase-igual-altura quase-igual-raio altura-toolbar padrao-width padrao-height sombra-prompt esquema-nativo',
    legibilidade:'texto-cortado contraste-texto texto-pequeno',
    layout:'estouro-horizontal',
    mídia:'imagem-quebrada imagem-distorcida',
    acessibilidade:'alvo-minimo controle-sem-nome imagem-sem-alt campo-sem-rotulo clicavel-sem-papel hierarquia-titulos zoom-bloqueado'
  })) for (const rule of rules.split(' ')) CATEGORY[rule]=category;
  function inspectRules(m) {
    const findings=[];
    // 1 CSS px absorve arredondamento subpixel de fonte/DPR; não esconde 2–4px.
    const tolerance=options.tolerancePx ?? 1;
    function flag(rule, e, delta, message, confidence, extra) {
      if (options.rules?.[rule]===false) return;
      const finding={ rule, category:CATEGORY[rule], selector:selector(e), component:e.getAttribute('aria-label') || e.textContent.trim().slice(0,64), deltaPx:delta===null ? null : round(delta), tolerancePx:tolerance, confidence, message, bounds:bounds(box(e)), ...extra };
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
      if (!parts.length || slotted(e).length) continue;
      const ys=parts.map(p=>midY(p.bounds));
      // Ícone empilhado acima ou abaixo do texto é uma coluna, e texto sobre o ícone é um selo: nenhum dos dois é um par a alinhar pelo centro.
      const over=(a,b)=>a.x<b.right && a.right>b.x && a.y<b.bottom && a.bottom>b.y;
      const stacked=texts.length===1 && icons.some(i=>i.bounds.bottom<=texts[0].bounds.y || i.bounds.y>=texts[0].bounds.bottom || over(i.bounds,texts[0].bounds));
      if (texts.length===1 && icons.length && !stacked && /center/.test(css.alignItems)) {
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
      if (!e.textContent.trim() && !slotted(e).some(n=>n.textContent.trim() || n.nodeType===1 && n.matches('[aria-label],[title],img[alt]:not([alt=""])')) && !['aria-label','aria-labelledby','title'].some(a=>e.getAttribute(a)) && !e.querySelector('[aria-label],[title],img[alt]:not([alt=""]),svg title')) {
        flag('controle-sem-nome',e,null,'Controle sem texto nem nome acessível (aria-label, aria-labelledby ou title).','medido');
      }
      if (computed(e).display==='inline') continue;
      const expanded=['::before','::after'].some(pseudo=>{
        const c=getComputedStyle(e,pseudo);
        return c.content!=='none' && c.position==='absolute' && parseFloat(c.width)>=24 && parseFloat(c.height)>=24;
      });
      const b=box(e);
      if (expanded || Math.min(b.width,b.height)>=24) continue;
      // Exceção de espaçamento do critério: um alvo pequeno passa quando o círculo de 24 px no seu centro não toca outro alvo.
      const cx=b.x+b.width/2, cy=b.y+b.height/2;
      const crowded=m.controls.some(o=>{
        if (o===e || within(o,e) || within(e,o)) return false;
        const r=box(o), dx=Math.max(r.left-cx,0,cx-r.right), dy=Math.max(r.top-cy,0,cy-r.bottom);
        return dx*dx+dy*dy<144;
      });
      if (crowded) add('alvo-minimo',e,24-Math.min(b.width,b.height),`Alvo de clique de ${round(b.width)}×${round(b.height)} px colado a outro alvo; o mínimo recomendado é 24×24 px ou espaço livre ao redor (WCAG 2.2, 2.5.8).`,'candidato');
    }
    const page=backdrop(document.body);
    if (page && luminance(page)<.18 && !/dark/.test(computed(document.documentElement).colorScheme)) {
      flag('esquema-nativo',document.documentElement,null,'Tema escuro sem `color-scheme: dark` em html; barras de rolagem e controles nativos permanecem claros.','candidato');
    }
    // Rolagem horizontal da página: quase sempre um elemento mais largo que a tela.
    const pageWidth=document.documentElement.clientWidth, spill=document.documentElement.scrollWidth-pageWidth;
    if (spill>tolerance) {
      const wide=m.components.filter(c=>computed(c.element).position!=='fixed' && box(c.element).right+scrollX>pageWidth+tolerance);
      const outer=wide.filter(c=>!wide.some(o=>o!==c && within(c.element,o.element))).slice(0,5);
      for (const c of outer) flag('estouro-horizontal',c.element,box(c.element).right+scrollX-pageWidth,`Passa ${round(box(c.element).right+scrollX-pageWidth)} px da largura da página e cria rolagem horizontal.`,'medido');
      if (!outer.length) flag('estouro-horizontal',document.documentElement,spill,`A página rola na horizontal: o conteúdo passa ${round(spill)} px da largura da tela.`,'medido');
    }
    for (const { element:e } of m.components) {
      if (e.localName!=='img') continue;
      const b=box(e), natural=e.naturalWidth/e.naturalHeight, drawn=b.width/b.height, ratio=n=>Math.round(n*100)/100;
      if (e.complete && !e.naturalWidth && (e.currentSrc || e.getAttribute('src'))) flag('imagem-quebrada',e,null,'A imagem não carregou.','medido');
      else if (e.naturalWidth>8 && e.naturalHeight>8 && computed(e).objectFit==='fill' && !/\.svg(\?|#|$)|^data:image\/svg/i.test(e.currentSrc) && Math.abs(natural-drawn)/natural>.05) {
        flag('imagem-distorcida',e,null,`Imagem esticada: exibida na proporção ${ratio(drawn)}, original em ${ratio(natural)}.`,'candidato');
      }
      if (!e.hasAttribute('alt') && e.getAttribute('role')!=='presentation' && !e.closest('[aria-hidden="true"]')) flag('imagem-sem-alt',e,null,'Imagem sem o atributo alt; use alt="" quando for decorativa.','medido');
    }
    for (const e of m.controls) {
      if (e.matches(FIELD) && !e.labels?.length && !e.closest('label') && !['aria-label','aria-labelledby','title','placeholder'].some(a=>e.getAttribute(a))) {
        flag('campo-sem-rotulo',e,null,'Campo sem rótulo: falta um label associado, aria-label ou aria-labelledby.','medido');
      }
    }
    for (const e of m.clickables) {
      flag('clicavel-sem-papel',e,null,e.hasAttribute('tabindex') ? 'Elemento clicável sem papel de botão ou link; leitores de tela não o anunciam como controle.' : 'Elemento clicável sem papel de botão ou link e fora da ordem de foco; o teclado não o alcança.','candidato');
    }
    const small=new Map();
    for (const p of m.textParents) {
      const size=parseFloat(computed(p).fontSize);
      if (size>=12 || p.closest('sup,sub')) continue;
      const group=small.get(size) || small.set(size,{ element:p, count:0 }).get(size);
      group.count++;
    }
    for (const [size,group] of small) flag('texto-pequeno',group.element,null,`Texto de ${round(size)} px${group.count>1 ? ` em ${group.count} lugares` : ''}; abaixo de 12 px a leitura fica difícil.`,'candidato',{ count:group.count });
    let previous=0;
    for (const heading of all('h1,h2,h3,h4,h5,h6,[role="heading"][aria-level]')) {
      if (own(heading) || !box(heading).width) continue;
      const level=+(heading.getAttribute('aria-level') || heading.localName[1]);
      if (previous && level>previous+1 && componentMap.has(heading)) flag('hierarquia-titulos',heading,null,`Título de nível ${level} logo depois de um de nível ${previous}; a hierarquia pula níveis.`,'candidato');
      previous=level;
    }
    const scale=document.querySelector('meta[name="viewport"]')?.content || '';
    if (/user-scalable\s*=\s*(no|0)/i.test(scale) || parseFloat(/maximum-scale\s*=\s*([\d.]+)/i.exec(scale)?.[1])<2) flag('zoom-bloqueado',document.documentElement,null,'O meta viewport impede ou limita o zoom da página.','medido');
    // Um valor quase igual ao padrão da tela costuma ser acidente: 35 px entre controles de 36 px, raio de 7 px entre raios de 8 px.
    const nearMiss=(rule,items,limit,describe)=>{
      const groups=new Map();
      for (const [e,value] of items) { const key=Math.round(value*2)/2; (groups.get(key) || groups.set(key,[]).get(key)).push(e); }
      for (const [value,list] of groups) {
        const standard=[...groups].find(([other,peers])=>Math.abs(other-value)>=1 && Math.abs(other-value)<=limit && peers.length>=4 && peers.length>=list.length*4);
        if (standard) flag(rule,list[0],Math.abs(standard[0]-value),describe(value,standard[0],list.length,standard[1].length),'candidato',{ count:list.length });
      }
    };
    nearMiss('quase-igual-altura',m.controls.filter(e=>e.matches(FIELD) || e.matches(ACTION) && computed(e).display!=='inline' && surface(e)).map(e=>[e,box(e).height]),2,
      (value,standard,count,peers)=>`Altura de ${value} px em ${count} ${count>1 ? 'controles' : 'controle'}; outros ${peers} medem ${standard} px.`);
    nearMiss('quase-igual-raio',m.components.filter(c=>surface(c.element) && radiusOf(c.element)>0 && radiusOf(c.element)<Math.min(box(c.element).width,box(c.element).height)/2).map(c=>[c.element,radiusOf(c.element)]),1,
      (value,standard,count,peers)=>`Raio de ${value} px em ${count} ${count>1 ? 'elementos' : 'elemento'}; outros ${peers} usam ${standard} px.`);
    for (const cohort of options.cohorts || []) {
      for (const e of document.querySelectorAll(cohort.selector)) {
        if (!shown(e)) continue;
        for (const dimension of ['width','height']) {
          const expected=cohort[dimension];
          if (Number.isFinite(expected) && expected>0) add('padrao-'+dimension,e,Math.abs(box(e)[dimension]-expected),`${cohort.name || 'Grupo'}: ${dimension} deve medir ${expected} px conforme o padrão informado.`,'requisito');
        }
      }
    }
    return findings;
  }

  // Contexto do produto: folhas de estilo, tokens, temas, tecnologias e componentes.
  let scanCache=null;
  function scanStyles() {
    // Percorrer folhas grandes custa caro; o resultado vale enquanto a contagem de regras de cada folha não mudar.
    const sheets=roots.flatMap(root=>[...root.styleSheets,...(root.adoptedStyleSheets || [])]);
    const signature=sheets.map(sheet=>{ try { return sheet.cssRules.length; } catch { return 'x'; } }).join(',');
    if (scanCache?.signature!==signature) {
      const defs=new Map(), layers=new Set(), properties=new Set();
      let blocked=0;
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
          if (rule.style && rule.selectorText) for (const name of rule.style) if (name.startsWith('--')) (defs.get(name) || defs.set(name,[]).get(name)).push({ selector:rule.selectorText, condition, value:rule.style.getPropertyValue(name).trim() });
          if (rule.cssRules?.length) walk(rule.cssRules,rule.conditionText && /Media|Container|Supports/.test(type) ? (condition+' '+rule.conditionText).trim() : condition);
        }
      };
      for (const sheet of sheets) { try { walk(sheet.cssRules,''); } catch { blocked++; } }
      scanCache={ signature, defs, layers, properties, sheets:sheets.length, blocked };
    }
    const defs=new Map(scanCache.defs);
    for (const [e,selector] of [[document.documentElement,':root'],[document.body,'body']]) for (const name of e.style) if (name.startsWith('--')) defs.set(name,[...(defs.get(name) || []),{ selector, condition:'', value:e.style.getPropertyValue(name).trim() }]);
    return { ...scanCache, defs };
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
    if (!/var\(|light-dark\(|color-mix\(|currentcolor|calc\(|from /i.test(css)) { const direct=rgba(css); return direct && { hex:hex(direct), format }; }
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
    const index=new Map(), colors=[], holders=new Map();
    const holderOf=selector=>{
      if (!holders.has(selector)) { let e=null; try { e=document.querySelector(selector); } catch {} holders.set(selector,e); }
      return holders.get(selector);
    };
    for (const [name,defs] of scan.defs) {
      if (name.startsWith('--tw-')) continue;
      out.total++;
      let value=bodyStyle.getPropertyValue(name).trim();
      for (const d of value ? [] : defs.slice(0,3)) {
        const holder=holderOf(d.selector);
        if (holder) value=getComputedStyle(holder).getPropertyValue(name).trim();
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
    const themeWord=key=>key.replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase().split(/[^a-z]+/).some(word=>/^(dark|light|themes?|mode|scheme|contrast|night|dim)$/.test(word));
    const named=[...scopes].filter(([key])=>/^(?:\.[\w-]+|\[[^\]]+\])$/.test(key) && themeWord(key));
    const themes=[], local=[];
    for (const [key,map] of named) {
      const attribute=/^\[([\w-]+)/.exec(key)?.[1];
      if ([...map].filter(([n,value])=>(base.has(n) || attribute && named.some(([other,tokens])=>other!==key && other.startsWith('['+attribute) && tokens.has(n))) && tokenColor(n,value)).length<2) continue;
      let target=null, active=false;
      try {
        const e=[document.documentElement,document.body].find(el=>el.matches(key)) || document.querySelector(key);
        active=!!e;
        const holder=e || (attribute && document.querySelector('['+attribute+']'));
        if (holder) target=holder===document.documentElement ? 'html' : holder===document.body ? 'body' : selector(holder);
      } catch {}
      const value=/=["']?([^"'\]]+)/.exec(key)?.[1];
      (active && target!=='html' && target!=='body' ? local : themes).push({ name:value || key.replace(/^[.\[]|\]$/g,''), selector:key, mechanism:key.startsWith('.') ? 'classe' : 'atributo', target, active, tokens:map.size, values:values(map) });
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
    add('Next.js','framework',global('__NEXT_DATA__') || global('__next_f') || marker('#__next'),/^(9|\d\d)\./.test(w.next?.version || '') ? w.next.version : undefined);
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
    add('Flutter Web','framework',marker('flutter-view,flt-glass-pane'));
    add('Lit','framework',global('litElementVersions'),w.litElementVersions?.[0]);
    add('Alpine.js','framework',global('Alpine') || marker('[x-data]'),w.Alpine?.version);
    add('htmx','framework',global('htmx') || marker('[hx-get],[hx-post],[hx-boost]','atributos hx-*'),w.htmx?.version);
    add('jQuery','biblioteca',w.jQuery?.fn?.jquery && 'window.jQuery',w.jQuery?.fn?.jquery);
    add('Vite (servidor de desenvolvimento)','build',marker('script[src*="/@vite/client"]','/@vite/client'));
    const generator=document.querySelector('meta[name="generator"]')?.content;
    add(generator,'gerador',generator && 'meta generator');
    add('Tailwind CSS','estilo',token('--tw-'),scan.layers.has('theme') && scan.layers.has('utilities') ? '4' : undefined);
    for (const [prefix,name] of Object.entries({ '--bs-':'Bootstrap', '--cui-':'CoreUI', '--chakra-':'Chakra UI', '--mantine-':'Mantine', '--mui-':'MUI', '--ant-':'Ant Design', '--el-':'Element Plus', '--v-theme-':'Vuetify', '--ion-':'Ionic', '--sl-':'Shoelace', '--cds-':'Carbon', '--spectrum-':'Spectrum', '--md-sys-':'Material Web', '--bulma-':'Bulma' })) add(name,'estilo',token(prefix));
    const named=n=>found.some(f=>f.name===n);
    if (!named('MUI')) add('MUI','estilo',marker('[class*="Mui"]','classes Mui*'));
    if (!named('Ant Design')) add('Ant Design','estilo',marker('[class^="ant-"],[class*=" ant-"]','classes ant-*'));
    if (!named('Vuetify')) add('Vuetify','estilo',marker('.v-application'));
    add('Quasar','componentes',marker('.q-layout,.q-btn','classes q-*'));
    add('PrimeReact / PrimeVue','componentes',marker('.p-component','classes p-*'));
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
    for (const [selector,name] of CHARTS) add(name,'gráficos',marker(selector,'marcação do gráfico'));
    add('Chart.js','gráficos',w.Chart?.getChart && 'window.Chart',w.Chart?.version);
    return found;
  }
  // Padrões feitos à mão que a plataforma web já oferece; cada um vira uma busca no Modern Web Guidance.
  function platformHints(theme) {
    const hints=[];
    const add=(pattern,selector,query)=>{
      let count=0;
      try { count=selector===true ? 1 : all(selector).filter(e=>!own(e)).length; } catch {}
      if (count) hints.push({ pattern, count, query });
    };
    add('diálogo sem o elemento <dialog>','[role="dialog"]:not(dialog),[role="alertdialog"]:not(dialog),[aria-modal="true"]:not(dialog)','modal dialog element');
    add('menu, lista ou dica flutuante sem a Popover API','[role="menu"]:not([popover]),[role="listbox"]:not([popover]),[role="tooltip"]:not([popover])','popover API anchor positioning');
    if (theme.themes.length && theme.colorScheme==='normal' && !theme.usesLightDark) add('tema alternado sem color-scheme nem light-dark()',true,'dark mode light-dark color-scheme');
    return hints;
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
    const type={ families:count(), sizes:count(), weights:count() }, radii=count(), spacing=count(), heights=count();
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
      for (const value of [css.paddingTop,css.paddingLeft,/flex|grid/.test(css.display) ? css.columnGap : '',/flex|grid/.test(css.display) ? css.rowGap : '']) if (parseFloat(value)>0) bump(spacing,round(parseFloat(value))+'px');
      if (e.matches(ACTION+','+FIELD) && css.display!=='inline') bump(heights,round(box(e).height)+'px');
      const radius=css.borderTopLeftRadius.split(' ')[0];
      if (parseFloat(radius)) bump(radii,radius.endsWith('%') ? radius : parseFloat(radius)>=500 ? 'pílula' : round(parseFloat(radius))+'px');
    }
    const top=(map,limit=8)=>[...map].sort((a,b)=>b[1]-a[1]).slice(0,limit).map(([value,count])=>({ value, count }));
    const palette=[...colors.values()].sort((a,b)=>b.text+b.background+b.border-a.text-a.background-a.border).slice(0,24);
    return { used:new Set(colors.keys()), palette, typography:{ families:top(type.families), sizes:top(type.sizes), weights:top(type.weights) }, radii:top(radii), spacing:top(spacing,10), controlHeights:top(heights,6) };
  }
  function context(m=measure()) {
    const scan=scanStyles(), { used, palette, typography, radii, spacing, controlHeights }=usage(m), { tokens, index }=readTokens(scan,used);
    for (const color of palette) color.tokens=(index.get(color.hex) || []).slice(0,3);
    const theme=readTheme(scan);
    const data={ version:VERSION, route:location.pathname, viewport:{ width:innerWidth, height:innerHeight, dpr:devicePixelRatio }, focus:m.focus, technologies:technologies(scan), theme, tokens, palette, typography, radii, spacing, controlHeights, components:inventory(m), platform:platformHints(theme) };
    return { data, index };
  }

  // As guias são desenhadas em canvas: milhares de contornos sem criar nós nem forçar o layout da página.
  let pen=null;
  function prepare(surface) {
    const ratio=Math.min(2,devicePixelRatio || 1), width=Math.round(innerWidth*ratio), height=Math.round(innerHeight*ratio);
    if (surface.width!==width || surface.height!==height) { surface.width=width; surface.height=height; }
    pen=surface.getContext('2d');
    pen.setTransform(ratio,0,0,ratio,0,0);
    pen.clearRect(0,0,innerWidth,innerHeight);
  }
  const red = '#ef4444';
  const crisp = n => Math.round(n)+.5;
  // Um halo claro sob o traço mantém a guia legível sobre fundos escuros ou saturados.
  function strokePath(trace, opacity, dash) {
    pen.setLineDash(dash || []);
    pen.beginPath();
    trace();
    pen.globalAlpha=opacity*.35; pen.strokeStyle='#fff'; pen.lineWidth=2.5; pen.stroke();
    pen.globalAlpha=opacity; pen.strokeStyle=red; pen.lineWidth=1; pen.stroke();
  }
  const boxes = (list, opacity, dash) => {
    if (list.length) strokePath(()=>{ for (const b of list) pen.rect(crisp(b.x),crisp(b.y),Math.max(0,Math.round(b.width)-1),Math.max(0,Math.round(b.height)-1)); },opacity,dash);
  };
  const line = (x1, y1, x2, y2, opacity = .65, dash) => strokePath(()=>{ pen.moveTo(crisp(x1),crisp(y1)); pen.lineTo(crisp(x2),crisp(y2)); },opacity,dash);
  function label(x, y, text, size = 11) {
    pen.setLineDash([]);
    pen.font=`${size}px ui-monospace,SFMono-Regular,Menlo,monospace`;
    const width=pen.measureText(text).width+8, height=size+7;
    pen.globalAlpha=.94; pen.fillStyle='#991b1b';
    pen.beginPath();
    if (pen.roundRect) pen.roundRect(x-4,y-height+6,width,height,3); else pen.rect(x-4,y-height+6,width,height);
    pen.fill();
    pen.globalAlpha=1; pen.fillStyle='#fff';
    pen.fillText(text,x,y);
  }
  const outline = (e, opacity = .3, solid = false) => boxes([box(e)],opacity,solid ? null : [3,3]);
  function drawPart(part, opacity=.32) {
    boxes([part.bounds],opacity);
    if (Number.isFinite(part.baselineApprox)) line(part.bounds.x,part.baselineApprox,part.bounds.right,part.baselineApprox,opacity,[2,2]);
  }
  function paint(m, findings) {
    prepare(baseCanvas);
    const controls=new Set(m.controls), parts=m.internals.flatMap(c=>c.parts);
    const framed=c=>/^(Card|Superfície|Gráfico|Imagem vetorial|Canvas|Imagem|Vídeo)$/.test(c.type);
    boxes(m.controls.map(box),.3,[3,3]);
    boxes(m.components.filter(c=>!controls.has(c.element) && !framed(c)).map(c=>box(c.element)),.13,[3,3]);
    boxes(m.components.filter(c=>!controls.has(c.element) && framed(c)).map(c=>box(c.element)),.7,[6,3]);
    // O contorno de um contêiner coincide com a borda dele; a etiqueta no canto diz o que foi reconhecido ali.
    for (const c of m.components) if (/^(Card|Superfície|Gráfico|Canvas)$/.test(c.type)) {
      const b=box(c.element);
      if (b.width>=c.type.length*5.4+16 && b.height>=22) label(Math.round(b.x)+4,Math.round(b.y)+10,c.type,9);
    }
    boxes(parts.map(p=>p.bounds),.32);
    const baselines=parts.filter(p=>Number.isFinite(p.baselineApprox));
    if (baselines.length) strokePath(()=>{ for (const p of baselines) { pen.moveTo(p.bounds.x,crisp(p.baselineApprox)); pen.lineTo(p.bounds.right,crisp(p.baselineApprox)); } },.32,[2,2]);
    boxes(findings.map(f=>findingElement.get(f)).filter(e=>e!==document.documentElement).map(box),.85);
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
  }
  function paintSelection(m) {
    prepare(selectionCanvas);
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
    if (!c) return { key:['empty',m.components.length], build:()=>[h('div',{class:'blank'},
      h('p',{class:'empty',text:'Passe o ponteiro sobre a página para inspecionar um componente.'}),
      h('p',{class:'hint',text:`${m.components.length} componentes em níveis N0–N${Math.max(0,...m.components.map(x=>x.level))}.`})
    )] };
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
    if (!findings.length) return { key:['none'], build:()=>[h('div',{class:'blank'},h('p',{class:'empty',text:'Nenhum candidato automático. A composição ainda exige inspeção visual.'}))] };
    return { key:[findings.map(f=>[f.rule,f.selector,f.deltaPx,f.message]),findings.map(f=>findingElement.get(f)===pinned)], build:()=>[
      h('ul',{class:'findings'},findings.map(f=>{
        const target=findingElement.get(f), current=target===pinned;
        return h('li',null,h('button',{type:'button','aria-current':String(current),title:f.selector,onclick:()=>{ pinned=current ? null : target; hovered=pinned; touch(); }},
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
      sections.push(h('div',{class:'row'},h('button',{class:'text',type:'button',text:'Atualizar',onclick:()=>{ scanCache=null; contextCache=null; bodyKey=''; render(); }})));
      return sections;
    } };
  }
  function render() {
    const { m, findings }=last;
    summary.textContent=minimized ? `${findings.length} ${findings.length===1 ? 'achado' : 'achados'}` : '';
    badge.textContent=findings.length;
    badge.toggleAttribute('data-zero',!findings.length);
    focusBar.hidden=focusOn && !m.focus.layer;
    focusText.textContent=focusOn ? `Em foco: ${m.focus.layer?.name || 'diálogo'} · ${m.focus.covered} fora` : 'Foco desligado';
    focusText.title=focusOn ? `${m.focus.covered} elementos cobertos por esta camada ficaram fora da inspeção` : 'Tudo o que é visível entra na inspeção, inclusive o que está coberto';
    focusButton.textContent=focusOn ? 'Ver tudo' : 'Focar';
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
    if (last) touch(true);
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
  // Sem posição escolhida pelo usuário, o painel fica no canto que menos cobre controles e conteúdo.
  // O canto é uma âncora: o painel cresce a partir dele e só troca quando o ganho é claro, para não pular enquanto a página rola.
  let anchor='br';
  function dockPanel(m) {
    const b=host.getBoundingClientRect(), pad=16;
    if (userPlaced) return place(b.x,b.y);
    const right=innerWidth-b.width-pad, bottom=innerHeight-b.height-pad, middle=Math.max(pad,(innerHeight-b.height)/2);
    const spots={ br:[right,bottom], tr:[right,pad], mr:[right,middle], ml:[pad,middle] };
    const obstacles=[...m.controls.map(e=>({rect:box(e),weight:4})),...m.components.filter(c=>c.element.matches('p,h1,h2,h3,img,table,pre')).map(c=>({rect:box(c.element),weight:1}))];
    const score=([x,y])=>obstacles.reduce((sum,o)=>sum+Math.max(0,Math.min(x+b.width,o.rect.right)-Math.max(x,o.rect.x))*Math.max(0,Math.min(y+b.height,o.rect.bottom)-Math.max(y,o.rect.y))*o.weight,0);
    const best=Object.keys(spots).reduce((a,k)=>score(spots[k])<score(spots[a]) ? k : a,anchor);
    if (score(spots[best])<score(spots[anchor])-b.width*b.height/2) anchor=best;
    place(...spots[anchor]);
  }
  function startDrag(e) {
    const b=host.getBoundingClientRect();
    drag={ x:e.clientX-b.x, y:e.clientY-b.y };
    panel.classList.add('dragging');
  }
  const moveDrag=e=>{ if (drag) place(e.clientX-drag.x,e.clientY-drag.y,true); };
  const endDrag=()=>{ drag=null; panel.classList.remove('dragging'); };
  // O ponteiro sobre o painel é tratado na janela, antes da aplicação, e encaminhado pela geometria.
  // Assim um clique no inspetor não fecha o menu ou o modal em inspeção (detecção de clique fora), e o painel
  // continua utilizável quando um <dialog> modal nativo o torna inerte.
  function routed(e) {
    if (!panelOn) return;
    const path=e.composedPath(), fromPanel=path.includes(host);
    const point=e.changedTouches?.[0] || e;
    const inside=r=>r.width>0 && point.clientX>=r.left && point.clientX<=r.right && point.clientY>=r.top && point.clientY<=r.bottom;
    if (!fromPanel && !inside(host.getBoundingClientRect())) return;
    e.stopImmediatePropagation();
    if (!fromPanel) e.preventDefault();
    const button=fromPanel ? path.find(x=>x instanceof Element && x.matches('button')) : [...shadow.querySelectorAll('button')].find(x=>inside(x.getBoundingClientRect()));
    const onHead=(fromPanel ? path.includes(head) : inside(head.getBoundingClientRect())) && (!button || button===grip);
    if (e.type==='click') button?.dispatchEvent(new MouseEvent('click'));
    else if (e.type==='pointerdown' && e.button===0 && onHead) startDrag(e);
    else if (e.type==='pointerup') endDrag();
    else if (e.type==='dblclick' && onHead) { userPlaced=false; schedule(); }
  }
  const ROUTED=['pointerdown','mousedown','pointerup','mouseup','click','dblclick','touchstart','touchend'];
  for (const type of ROUTED) window.addEventListener(type,routed,true);
  window.addEventListener('pointermove',moveDrag,true);
  window.addEventListener('pointerup',endDrag,true);
  window.addEventListener('pointercancel',endDrag,true);
  // Teclas usadas no painel não devem acionar atalhos da aplicação.
  for (const type of ['keydown','keyup','keypress']) host.addEventListener(type,e=>e.stopPropagation());
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
  // Guias e painel entram na top layer como popovers manuais e voltam ao topo quando a aplicação abre
  // um diálogo modal ou outro popover depois deles.
  const overlays=[layer,host];
  let topLayer=null;
  function promote() {
    if (!layer.showPopover) return;
    try {
      const now=all(':modal,:popover-open').filter(e=>!own(e));
      if (topLayer && now.length===topLayer.length && now.every((e,i)=>e===topLayer[i])) return;
      topLayer=now;
    } catch { return; }
    for (const e of overlays) {
      try { e.hidePopover(); } catch {}
      try { e.showPopover(); } catch {}
    }
  }
  if (layer.showPopover) for (const e of overlays) e.setAttribute('popover','manual');
  // Bibliotecas de modal marcam os irmãos do diálogo como inertes; o painel precisa continuar utilizável.
  const guard=new MutationObserver(()=>{ for (const a of ['inert','aria-hidden']) if (host.hasAttribute(a)) host.removeAttribute(a); });
  guard.observe(host,{ attributes:true, attributeFilter:['inert','aria-hidden'] });
  let cost=0, timer=0, touchFrame=0;
  function draw(force) {
    frame = 0;
    if (!force && !guidesOn && !panelOn) return;
    const started = performance.now();
    const m = measure(), findings = inspectRules(m);
    last = { m, findings };
    promote();
    if (guidesOn) paint(m, findings);
    touch(true);
    cost = performance.now()-started;
  }
  // Mudança só de seleção ou de aba: redesenha a seleção e o painel sobre a última medição.
  function touch(now) {
    if (now!==true) { if (!touchFrame) touchFrame=requestAnimationFrame(()=>touch(true)); return; }
    cancelAnimationFrame(touchFrame); touchFrame=0;
    if (!last) return schedule();
    if (guidesOn) paintSelection(last.m);
    if (!panelOn) return;
    if (sheetCount!==document.styleSheets.length) { sheetCount=document.styleSheets.length; contextCache=null; }
    render();
    dockPanel(last.m);
  }
  // Em páginas pesadas ou que mudam a todo instante, o próximo desenho espera na proporção do custo do anterior.
  function schedule() {
    if (frame || timer || !(guidesOn || panelOn)) return;
    if (cost<=12) { frame=requestAnimationFrame(()=>draw()); return; }
    timer=setTimeout(()=>{ timer=0; frame=requestAnimationFrame(()=>draw()); },Math.min(600,cost*4));
  }
  function toggleFocus() {
    focusOn=!focusOn;
    schedule();
    return focusOn;
  }
  function toggleGuides() {
    guidesOn = !guidesOn;
    layer.style.display = guidesOn ? 'block' : 'none';
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
    if (hovered !== e) { hovered=e; touch(); }
  }
  window.addEventListener('resize', schedule);
  document.addEventListener('scroll', schedule, true);
  document.addEventListener('transitionend', schedule, true);
  document.addEventListener('pointerover', inspect, true);
  const resizeObserver = new ResizeObserver(schedule);
  // Quando o conteúdo do painel muda de tamanho, ele se reancora no mesmo quadro, sem medir a página de novo.
  const panelObserver = new ResizeObserver(()=>{ if (last && panelOn) dockPanel(last.m); });
  panelObserver.observe(host);
  for (const e of document.querySelectorAll(hooks.observe || 'main,aside,nav')) resizeObserver.observe(e);
  const mutationObserver = new MutationObserver(records=>{
    if (records.some(r=>!own(r.target))) schedule();
  });
  mutationObserver.observe(document.body, { childList:true, subtree:true,attributes:true,attributeFilter:['style','class','hidden','open','inert','aria-hidden','aria-modal','aria-expanded','aria-selected','data-state'] });
  document.addEventListener('toggle', schedule, true);
  // Trocas de tema acontecem em atributos de html e body.
  const themeObserver = new MutationObserver(()=>{ contextCache=null; bodyKey=''; schedule(); });
  for (const e of [document.documentElement,document.body]) themeObserver.observe(e,{ attributes:true });

  const rect=e=>{ const b=box(e); return { x:round(b.x), y:round(b.y), width:round(b.width), height:round(b.height) }; };
  const api = {
    version: VERSION, toggle, toggleGuides, togglePanel, toggleFocus,
    // Redesenha agora, sem esperar o próximo quadro: use depois de mudar a página e antes de uma captura.
    refresh() {
      cancelAnimationFrame(frame); clearTimeout(timer); frame=timer=0;
      scanCache=null; contextCache=null; bodyKey='';
      draw(true);
      return { components:last.m.components.length, findings:last.findings.length, covered:last.m.focus.covered };
    },
    movePanel(x, y) {
      userPlaced=x!==undefined;
      if (userPlaced) place(x,y,true); else schedule();
      return bounds(host.getBoundingClientRect());
    },
    select(path) {
      pinned=path ? find(path) : null;
      hovered=pinned;
      touch();
      return pinned ? bounds(pinned.getBoundingClientRect()) : null;
    },
    audit() {
      const m=measure();
      return { status:'heuristic',coverage:{controls:m.controls.length,components:m.components.length,internalParts:m.internals.reduce((n,c)=>n+c.parts.length,0),shadowRoots:roots.length-1,covered:m.focus.covered,frames:m.frames},focus:m.focus,tolerancePx:options.tolerancePx ?? 1, findings:inspectRules(m), typography:'Range mede caixas de texto; baseline e caixa de glifo são estimativas de TextMetrics.',
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
    // Percorre a página rolando a janela e junta os achados de cada trecho; devolve a rolagem ao ponto inicial.
    async scan({ maxScreens=12 }={}) {
      const start=[scrollX,scrollY], found=new Map(), step=Math.max(1,Math.round(innerHeight*.9));
      let screens=0, y=0;
      for (; screens<maxScreens; screens++, y+=step) {
        scrollTo({ left:start[0], top:y, behavior:'instant' }); // instant ignora o scroll-behavior: smooth da página
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        for (const f of inspectRules(measure())) if (!found.has(f.rule+' '+f.selector)) found.set(f.rule+' '+f.selector,{ ...f, scrollY:Math.round(scrollY) });
        if (scrollY+innerHeight>=document.documentElement.scrollHeight-1) { screens++; break; }
      }
      const complete=scrollY+innerHeight>=document.documentElement.scrollHeight-1;
      scrollTo({ left:start[0], top:start[1], behavior:'instant' });
      return { screens, complete, findings:[...found.values()] };
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
      if (c.spacing.length) lines.push('Espaçamentos: '+c.spacing.map(x=>`${x.value} ×${x.count}`).join(', '));
      if (c.controlHeights.length) lines.push('Alturas de controle: '+c.controlHeights.map(x=>`${x.value} ×${x.count}`).join(', '));
      if (c.components.names.length) lines.push('Componentes: '+list(c.components.names,20,n=>`${n.name} ×${n.count}`));
      if (c.platform.length) lines.push('Web moderna: '+c.platform.map(x=>`${x.pattern} ×${x.count} (busque "${x.query}")`).join('; '));
      lines.push(`Cobertura: ${m.components.length} componentes, ${m.controls.length} controles, ${roots.length-1} shadow roots abertos, somente a área visível`);
      if (!m.focus.on) lines.push('Foco: desligado; elementos cobertos por outras camadas entram na inspeção');
      else if (m.focus.covered) lines.push(`Foco: ${m.focus.layer ? `diálogo${m.focus.layer.name ? ' “'+m.focus.layer.name+'”' : ''} (${m.focus.layer.selector})` : 'camadas da frente'}; ${m.focus.covered} elementos cobertos ficaram de fora`);
      if (m.frames) lines.push(`Frames: ${m.frames} de mesma origem sem inspeção; injete o inspetor dentro do frame`);
      if (m.canvas) lines.push('Canvas: ocupa a maior parte da tela; o que é desenhado nele não é inspecionável');
      lines.push(`Achados (${findings.length}):`+(findings.length ? '' : ' nenhum candidato automático; a composição ainda exige inspeção visual'));
      // Padrões repetidos geram muitos achados iguais: uma linha por regra, com os primeiros alvos.
      const groups=new Map();
      for (const f of findings) (groups.get(f.rule) || groups.set(f.rule,[]).get(f.rule)).push(f);
      const order={ medido:0, requisito:1, candidato:2 };
      const sorted=[...groups].sort((a,b)=>order[a[1][0].confidence]-order[b[1][0].confidence]);
      for (const [rule,group] of sorted.slice(0,maxFindings)) {
        const f=group[0];
        lines.push(`- [${f.confidence} · ${f.category}] ${rule}${group.length>1 ? ' ×'+group.length : ''} · ${f.selector}${f.deltaPx===null ? '' : ' · '+f.deltaPx+' px'} · ${f.message}`+(group.length>1 ? ` · também em ${list(group.slice(1),3,x=>x.selector)}` : ''));
      }
      if (sorted.length>maxFindings) lines.push(`- e mais ${sorted.length-maxFindings} regras; use VisualInspector.audit().findings`);
      return lines.join('\n');
    },
    remove() {
      resizeObserver.disconnect(); mutationObserver.disconnect(); themeObserver.disconnect(); guard.disconnect(); panelObserver.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('scroll', schedule, true);
      document.removeEventListener('transitionend', schedule, true);
      document.removeEventListener('pointerover', inspect, true);
      document.removeEventListener('toggle', schedule, true);
      for (const type of ROUTED) window.removeEventListener(type,routed,true);
      window.removeEventListener('pointermove',moveDrag,true);
      window.removeEventListener('pointerup',endDrag,true);
      window.removeEventListener('pointercancel',endDrag,true);
      cancelAnimationFrame(frame); cancelAnimationFrame(touchFrame); clearTimeout(timer);
      layer.remove(); host.remove();
      if (window.VisualInspector===api) delete window.VisualInspector;
      options.onRemove?.();
    }
  };
  window.VisualInspector=api;
  if (!panelOn) host.style.display='none';
  setTab(tab);
  // Em tela estreita o painel cobriria metade do conteúdo: começa recolhido ao cabeçalho.
  if (innerWidth<520) setMinimized(true);
  place(innerWidth,innerHeight);
  draw();
  return api;

}

window.VisualInspector = installVisualInspector();
