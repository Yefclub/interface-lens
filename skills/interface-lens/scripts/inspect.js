/* Inspetor visual experimental: execute como Snippet em qualquer página.
 * Inspeciona DOM, caixas de texto e ícones; não altera o conteúdo da página.
 * API: VisualInspector.audit(), .measurements(), .toggleGuides(), .remove().
 */
function installVisualInspector(options) {
  'use strict';
  options = options || {};
  window.VisualInspector?.remove();
  const style=options.mockStyle || null;
  const hooks=options.selectors || {};
  const query=s=>s ? document.querySelector(s) : null;
  const guideStyle = document.createElement('style');
  guideStyle.id = 'visual-inspector-style';
  guideStyle.textContent = `
    #visual-inspector-guides { position:fixed; inset:0; width:100%; height:100%; pointer-events:none; z-index:2147483000; }
    #visual-inspector-guide-controls { --vi-bg:var(--bg-sidebar,#181716); --vi-fg:var(--text-primary,#fcfcfc); --vi-muted:var(--text-secondary,#aaa); position:fixed; right:16px; bottom:16px; width:min(440px,calc(100vw - 32px)); box-sizing:border-box; z-index:2147483001; padding:12px; border:1px solid color-mix(in srgb,var(--vi-fg) 14%,transparent); border-radius:var(--botao-raio,10px); background:var(--vi-bg); color:var(--vi-fg); font-family:var(--chat-font,system-ui,sans-serif); font-size:12px; line-height:18px; }
    #visual-inspector-guide-controls p { margin:0 0 8px; color:var(--vi-muted); }
    #visual-inspector-guide-controls div { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:8px; }
    #visual-inspector-guide-controls button { display:inline-flex; align-items:center; justify-content:center; height:var(--botao-altura-compacto,32px); padding:0 12px; border:1px solid color-mix(in srgb,var(--vi-fg) 14%,transparent); border-radius:var(--botao-raio,10px); background:transparent; color:var(--vi-fg); font:500 13px/1 var(--chat-font,system-ui,sans-serif); white-space:nowrap; cursor:pointer; }
    #visual-inspector-guide-controls button:hover { background:color-mix(in srgb,var(--vi-fg) 7%,transparent); border-color:color-mix(in srgb,var(--vi-fg) 24%,transparent); }
    #visual-inspector-guide-controls button:focus-visible { outline:2px solid var(--accent-primary,#7db7e8); outline-offset:2px; }
    #visual-inspector-guide-controls [hidden] { display:none !important; }
    #visual-inspector-guide-controls ol { max-height:180px; overflow:auto; margin:8px 0 0; padding-left:18px; font-size:11px; line-height:16px; }
    #visual-inspector-guide-controls li { margin-bottom:8px; }
  `;
  document.head.append(guideStyle);
  const svgNS = 'http://www.w3.org/2000/svg';
  const guides = document.createElementNS(svgNS, 'svg');
  guides.id = 'visual-inspector-guides';
  guides.setAttribute('aria-hidden', 'true');
  document.body.append(guides);
  const panel = document.createElement('section');
  panel.id = 'visual-inspector-guide-controls';
  panel.setAttribute('aria-label', 'Inspeção visual do mock');
  const summary = document.createElement('p');
  const detail = document.createElement('p');
  detail.style.cssText='height:36px;overflow:auto';
  detail.textContent = 'Passe o ponteiro: tipo, nível e dimensões do componente.';
  const actions = document.createElement('div');
  const compare = document.createElement('button');
  const hide = document.createElement('button');
  const reportButton = document.createElement('button');
  const reportList = document.createElement('ol');
  reportList.hidden = true;
  reportList.setAttribute('aria-label','Alertas de alinhamento');
  let reportKey = '';
  for (const button of [compare, hide, reportButton]) {
    button.type = 'button';
    button.className = 'botao botao-compacto botao-secundario';
    actions.append(button);
  }
  compare.textContent = 'Ver original';
  if (!style) compare.hidden=true;
  hide.textContent = 'Ocultar guias';
  hide.setAttribute('aria-pressed', 'true');
  reportButton.textContent = 'Relatório';
  reportButton.setAttribute('aria-expanded','false');
  reportButton.addEventListener('click',()=>{
    updateReport(audit(measure()));
    reportList.hidden=!reportList.hidden;
    reportButton.setAttribute('aria-expanded',String(!reportList.hidden));
  });
  panel.append(summary, detail, actions, reportList);
  document.body.append(panel);

  let geometryCache=new WeakMap(), styleCache=new WeakMap();
  const box = e => {
    if (panel.contains(e)) return e.getBoundingClientRect();
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
    for (let a=e; a; a=a.parentElement) {
      const c = computed(a), r = box(a);
      if (c.visibility === 'hidden' || c.opacity === '0' || c.display === 'none') return false;
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
  function selector(e) {
    const prefix = hooks.scope && e.closest(hooks.scope) ? hooks.scope+' ' : '';
    if (e.getAttribute('aria-label')) return prefix + e.localName + '[aria-label=' + JSON.stringify(e.getAttribute('aria-label')) + ']';
    if (e.getAttribute('data-dica')) return prefix+e.localName+'[data-dica='+JSON.stringify(e.getAttribute('data-dica'))+']';
    if (e.id) return '#' + CSS.escape(e.id);
    return prefix + e.localName + [...e.classList].slice(0,2).map(c=>'.'+CSS.escape(c)).join('');
  }
  function fontMetrics(text, css) {
    textContext.font = `${css.fontStyle} ${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
    return textContext.measureText(text);
  }
  function clipText(rect, parent) {
    let left=rect.x, right=rect.right, top=rect.y, bottom=rect.bottom;
    for (let a=parent; a; a=a.parentElement) {
      const css=computed(a), r=box(a);
      if (/auto|scroll|hidden|clip/.test(css.overflowX)) { left=Math.max(left,r.left); right=Math.min(right,r.right); }
      if (/auto|scroll|hidden|clip/.test(css.overflowY)) { top=Math.max(top,r.top); bottom=Math.min(bottom,r.bottom); }
    }
    return { x:left, y:top, width:Math.max(0,right-left), height:Math.max(0,bottom-top), right, bottom };
  }
  function partsFor(control, content=false) {
    const parts=[];
    const owner = e => e.closest('button,a[href],summary,[role="button"],[role="link"],[role="menuitem"],[role="menuitemradio"]');
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
  let componentMap = new Map();
  let hovered = null;
  let pinned = null;
  function identify(controls) {
    const textParents=new Set();
    const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const p=walker.currentNode.parentElement;
      if (!p || p.children.length || panel.contains(p) || guides.contains(p) || p.closest('script,style,noscript,svg,.sr-only,[aria-hidden="true"]')) continue;
      if (walker.currentNode.textContent.trim() && visible(p)) textParents.add(p);
    }
    const groups = [...document.querySelectorAll('nav,main,aside,section,header,footer,form,label,p,li,pre,blockquote,table,th,td,article,[role="article"],[role="dialog"],[role="group"],h1,h2,h3,video,audio,canvas,iframe,svg:not(#visual-inspector-guides),img'+(hooks.components ? ','+hooks.components : ''))];
    for (const icon of groups.filter(e=>e.matches('svg,img'))) {
      const parent=icon.parentElement;
      if (parent && parent.children.length===1 && !parent.textContent.trim() && /flex|grid/.test(computed(parent).display)) groups.push(parent);
    }
    const nodes = [...new Set([...groups, ...controls, ...textParents])].filter(e => !panel.contains(e) && !guides.contains(e) && visible(e));
    const nodeSet = new Set(nodes);
    const components = nodes.map(e => {
      let parent = e.parentElement;
      while (parent && !nodeSet.has(parent)) parent = parent.parentElement;
      let level = 0;
      for (let a=parent; a; a=a.parentElement) if (nodeSet.has(a)) level++;
      const custom=options.describe?.(e) || {};
      const role=e.getAttribute('role');
      const type=custom.type || ({ NAV:'Navegação', MAIN:'Conteúdo', ASIDE:'Barra lateral', BUTTON:'Botão', A:'Link', SUMMARY:'Ação expansível', LABEL:'Rótulo', P:'Parágrafo', LI:'Item', PRE:'Código', BLOCKQUOTE:'Citação', TABLE:'Tabela', TH:'Célula', TD:'Célula', ARTICLE:'Artigo', H1:'Título', H2:'Título', H3:'Título', INPUT:'Campo', TEXTAREA:'Campo', SELECT:'Seletor', SECTION:'Seção', FORM:'Formulário', SVG:'Ícone', IMG:'Imagem', VIDEO:'Vídeo', AUDIO:'Áudio', CANVAS:'Canvas', IFRAME:'Frame' }[e.tagName.toUpperCase()] ||
        { button:'Botão', textbox:'Campo', dialog:'Diálogo', group:'Grupo', slider:'Slider', progressbar:'Progresso', menuitem:'Item de menu', menuitemradio:'Opção de menu', menuitemcheckbox:'Opção de menu', tab:'Aba', option:'Opção' }[role] || (textParents.has(e) ? 'Texto' : 'Grupo'));
      const name=custom.name || e.getAttribute('aria-label') || e.getAttribute('data-dica') || e.getAttribute('alt') || e.getAttribute('title') || (['Botão','Linha','Título','Texto','Link'].includes(type) ? e.textContent.trim().slice(0,64) : type);
      return { element:e, parent, level, type, name };
    });
    componentMap = new Map(components.map(c => [c.element,c]));
    return components;
  }
  function measure() {
    // Uma leitura por elemento em cada snapshot; nunca reaproveitar após edição.
    geometryCache=new WeakMap();styleCache=new WeakMap();
    const sidebar=query(hooks.sidebar);
    const composer=query(hooks.composer);
    const main=query(hooks.main || 'main');
    const rows=sidebar && hooks.rows ? [...sidebar.querySelectorAll(hooks.rows)].filter(visible) : [];
    const labels=rows.map(row=>options.labelForRow ? options.labelForRow(row) : hooks.label ? row.querySelector(hooks.label) : null).filter(Boolean);
    const toolbarRoot=options.toolbarRoot?.(composer) || query(hooks.toolbar);
    const toolbar=toolbarRoot ? [...toolbarRoot.querySelectorAll('button')].filter(e=>visible(e) && box(e).y>=box(toolbarRoot).y-1 && box(e).bottom<=box(toolbarRoot).bottom+1) : [];
    const controls = [...document.querySelectorAll('button,a[href],summary,input:not([type="hidden"]),textarea,select,[role="button"],[role="link"],[role="textbox"],[role="checkbox"],[role="switch"],[role="slider"],[role="progressbar"],[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],[role="tab"],[role="option"]')].filter(e => !panel.contains(e) && visible(e));
    const sidebarActions = sidebar && hooks.actions ? [...sidebar.querySelectorAll(hooks.actions)].filter(visible) : [];
    const components = identify(controls);
    const internals = controls.filter(e=>e.matches('button,a[href],summary,[role="button"],[role="link"],[role="menuitem"],[role="menuitemradio"]')).map(e=>({ element:e, parts:partsFor(e) }));
    for (const c of components.filter(c=>c.type==='Texto' || c.element.matches('p,h1,h2,h3,th,td,label'))) internals.push({element:c.element,parts:partsFor(c.element,true)});
    const labelLevels=new Map();
    for (const e of labels) {
      const level=componentMap.get(hooks.rows ? e.closest(hooks.rows) : e)?.level || 0;
      if (!labelLevels.has(level)) labelLevels.set(level,[]);
      labelLevels.get(level).push(box(e).x);
    }
    return {
      sidebar, composer, main, rows, labels, toolbar, controls, sidebarActions, components, internals,
      textDelta: Math.max(0,...[...labelLevels.values()].map(spread)),
      toolbarDelta: spread(toolbar.map(centerY)),
      actionDelta: spread(sidebarActions.map(centerX)),
      composerDelta: composer && main ? Math.abs(centerX(composer) - centerX(main)) : null
    };
  }
  function audit(m) {
    const findings=[];
    // 1 CSS px absorve arredondamento subpixel de fonte/DPR; não esconde 2–4px.
    const tolerance=options.tolerancePx ?? 1;
    function add(rule, e, delta, message, confidence='medido') {
      if (delta<=tolerance) return;
      findings.push({ rule, selector:selector(e), component:e.getAttribute('aria-label') || e.textContent.trim().slice(0,64), deltaPx:round(delta), tolerancePx:tolerance, confidence, message });
    }
    if (m.labels.length) add('coluna-titulos',m.labels[0],m.textDelta,'Títulos do mesmo nível começam em colunas diferentes.');
    if (m.toolbar.length) {
      add('centro-toolbar',m.toolbar[0],m.toolbarDelta,'Os centros verticais dos botões do prompt diferem.');
      add('altura-toolbar',m.toolbar[0],spread(m.toolbar.map(e=>box(e).height)),'Há alturas diferentes no mesmo grupo de botões.');
    }
    const header=m.sidebar && hooks.headerActions ? [...m.sidebar.querySelectorAll(hooks.headerActions)].filter(visible) : [];
    if (m.sidebarActions.length && header.length) add('coluna-acoes',header[0],spread([...m.sidebarActions,...header].map(centerX)),'As ações configuradas têm eixos horizontais diferentes.','candidato');
    if (options.requirements?.noComposerShadow && m.composer && computed(m.composer).boxShadow!=='none') findings.push({ rule:'sombra-prompt',selector:selector(m.composer),deltaPx:null,confidence:'requisito',message:'A sombra ainda está presente no componente configurado.' });
    for (const {element:e,parts} of m.internals) {
      if (!e.matches('button,a[href],summary,[role="button"],[role="link"],[role="menuitem"],[role="menuitemradio"]')) continue;
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
      if (parent && !e.matches('svg,img') && !['absolute','fixed'].includes(computed(e).position)) {
        const css=computed(parent), self=computed(e).alignSelf;
        if (/flex/.test(css.display) && css.flexDirection==='row' && css.flexWrap==='nowrap' && css.alignItems==='center' && (self==='auto'||self==='center')) {
          add('componente-linha-y',e,Math.abs(centerY(e)-centerY(parent)),'O componente está deslocado do eixo vertical da sua linha; confira a intenção.','candidato');
        }
      }
      if (textOwners.has(e)) continue;
      if (e.children.length!==1 || !e.firstElementChild.matches('svg,img') || e.textContent.trim()) continue;
      const css=computed(e), icon=e.firstElementChild;
      if (!/flex|grid/.test(css.display) || !visible(icon)) continue;
      if (css.alignItems==='center') add('icone-slot-y',e,Math.abs(centerY(icon)-centerY(e)),'O ícone não está no centro vertical da sua caixa.');
      if (css.justifyContent==='center' || css.justifyItems==='center') add('icone-slot-x',e,Math.abs(centerX(icon)-centerX(e)),'O ícone não está no centro horizontal da sua caixa.');
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
  function outline(e, opacity = .3) {
    const b = box(e);
    element('rect', { x:b.x, y:b.y, width:b.width, height:b.height, rx:3, fill:'none', stroke:red, 'stroke-width':1, 'stroke-dasharray':'3 3', opacity });
  }
  function drawPart(part, opacity=.32) {
    const b=part.bounds;
    element('rect',{ x:b.x,y:b.y,width:b.width,height:b.height,fill:'none',stroke:red,'stroke-width':1,opacity });
    if (part.baselineApprox!==undefined && Number.isFinite(part.baselineApprox)) {
      element('line',{ x1:b.x,y1:part.baselineApprox,x2:b.right,y2:part.baselineApprox,stroke:red,'stroke-width':1,'stroke-dasharray':'2 2',opacity });
    }
  }
  function updateReport(findings) {
    reportButton.textContent=`Relatório (${findings.length})`;
    const key=JSON.stringify(findings);
    if (key===reportKey) return;
    reportKey=key;
    reportList.replaceChildren();
    if (!findings.length) {
      const item=document.createElement('li');
      item.textContent='Nenhum candidato automático. A composição ainda exige inspeção visual.';
      reportList.append(item);
    }
    for (const f of findings) {
      const item=document.createElement('li');
      item.textContent=`${f.confidence}: ${f.component || f.selector} · ${f.deltaPx===null ? '' : f.deltaPx+' px · '}${f.message}`;
      reportList.append(item);
    }
  }
  function dockPanel(m) {
    const pad=16;
    // Uma coluna livre entre navegação e conteúdo evita cobrir o próprio alvo.
    if (m.main && m.composer) {
      const gutter=Math.min(440,box(m.composer).x-box(m.main).x-24);
      if (gutter>=260) {
        panel.style.width=gutter+'px';
        panel.style.left=(box(m.main).x+12)+'px';
        panel.style.top=Math.max(pad,(innerHeight-box(panel).height)/2)+'px';
        panel.style.right='auto';panel.style.bottom='auto';
        return;
      }
    }
    panel.style.width='min(440px,calc(100vw - 32px))';
    const b=box(panel);
    const right=innerWidth-b.width-pad, bottom=innerHeight-b.height-pad;
    const middle=Math.max(pad,(innerHeight-b.height)/2);
    const candidates=[{x:b.x,y:b.y},{x:right,y:bottom},{x:right,y:pad},{x:right,y:middle},{x:pad,y:middle}].map(c=>({x:Math.max(pad,Math.min(right,c.x)),y:Math.max(pad,Math.min(bottom,c.y))}));
    const obstacles=[...m.controls.map(e=>({rect:box(e),weight:4})),...m.components.filter(c=>c.element.matches('p,h1,h2,h3,img,table,pre')).map(c=>({rect:box(c.element),weight:1}))];
    const score=c=>obstacles.reduce((sum,o)=>sum+Math.max(0,Math.min(c.x+b.width,o.rect.right)-Math.max(c.x,o.rect.x))*Math.max(0,Math.min(c.y+b.height,o.rect.bottom)-Math.max(c.y,o.rect.y))*o.weight,0);
    candidates.sort((a,b)=>score(a)-score(b));
    const best=candidates[0];
    panel.style.left=Math.max(pad,best.x)+'px';
    panel.style.top=Math.max(pad,best.y)+'px';
    panel.style.right='auto'; panel.style.bottom='auto';
  }
  function draw() {
    frame = 0;
    if (!guidesOn) return;
    guides.replaceChildren();
    guides.setAttribute('viewBox', `0 0 ${innerWidth} ${innerHeight}`);
    const m = measure();
    m.controls.forEach(e => outline(e));
    m.components.filter(c => !m.controls.includes(c.element)).forEach(c => outline(c.element, .13));
    m.internals.forEach(c=>c.parts.forEach(p=>drawPart(p)));
    document.querySelectorAll('main h1').forEach(e => { if (visible(e)) outline(e, .5); });
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
    summary.textContent = `${m.components.length} componentes · ${m.controls.length} controles · níveis N0–N${Math.max(0,...m.components.map(c=>c.level))}`;
    updateReport(audit(m));
    const selected = componentMap.get(hovered);
    if (selected) {
      outline(selected.element, 1);
      const b = box(selected.element);
      const path = [selected];
      for (let c=componentMap.get(selected.parent); c; c=componentMap.get(c.parent)) path.unshift(c);
      detail.textContent = path.map(c=>`N${c.level} ${c.type}${c.type==='Seção' ? ': '+c.name : ''}`).join(' › ');
      const inside=m.internals.find(c=>c.element===selected.element) || m.internals.find(c=>c.element.contains(selected.element));
      if (inside) {
        inside.parts.forEach(p=>{
          drawPart(p,.95);
          const r=p.bounds, y=midY(r);
          line(r.x,y,r.right,y,.8);
        });
        const icon=inside.parts.find(p=>p.type==='Ícone'), text=inside.parts.find(p=>p.type.startsWith('Texto'));
        if (icon && text) detail.textContent+=` · ícone/texto Δy ${round(Math.abs(midY(icon.bounds)-midY(text.bounds)))} px · gap ${round(text.bounds.x-icon.bounds.right)} px`;
      }
      const text = `N${selected.level} ${selected.type} | ${round(b.width)}×${round(b.height)} | x${round(b.x)} y${round(b.y)}`;
      label(Math.min(innerWidth-text.length*6.8-16, Math.max(322,b.right+12)), Math.max(20, Math.min(innerHeight-120,b.y+14)), text);
    } else {
      detail.textContent = 'Passe o ponteiro: tipo, nível e dimensões do componente.';
    }
    dockPanel(m);
  }
  let guidesOn = true;
  let frame = 0;
  function schedule() { if (!frame && guidesOn) frame = requestAnimationFrame(draw); }
  function toggleGuides() {
    guidesOn = !guidesOn;
    guides.style.display = guidesOn ? '' : 'none';
    hide.textContent = guidesOn ? 'Ocultar guias' : 'Mostrar guias';
    hide.setAttribute('aria-pressed', String(guidesOn));
    schedule();
    return guidesOn;
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
    if (e && panel.contains(e)) e = null;
    while (e && !componentMap.has(e)) e = e.parentElement;
    if (hovered !== e) { hovered=e; schedule(); }
  }
  compare.addEventListener('click', toggle);
  hide.addEventListener('click', toggleGuides);
  window.addEventListener('resize', schedule);
  document.addEventListener('scroll', schedule, true);
  document.addEventListener('transitionend', schedule, true);
  document.addEventListener('pointerover', inspect, true);
  const resizeObserver = new ResizeObserver(schedule);
  resizeObserver.observe(panel);
  for (const e of document.querySelectorAll(hooks.observe || 'main,aside,nav')) resizeObserver.observe(e);
  const mutationObserver = new MutationObserver(records=>{
    if (records.some(r=>!panel.contains(r.target) && !guides.contains(r.target))) schedule();
  });
  mutationObserver.observe(document.getElementById('root') || document.body, { childList:true, subtree:true,attributes:true,attributeFilter:['style','class','hidden','aria-expanded','aria-selected'] });
  const api = {
    version: '2.0.0', toggle, toggleGuides,
    select(selector) {
      pinned=selector ? document.querySelector(selector) : null;
      hovered=pinned;
      schedule();
      return pinned ? bounds(pinned.getBoundingClientRect()) : null;
    },
    audit() {
      const m=measure();
      return { status:'heuristic',coverage:{controls:m.controls.length,components:m.components.length,internalParts:m.internals.reduce((n,c)=>n+c.parts.length,0)},tolerancePx:options.tolerancePx ?? 1, findings:audit(m), typography:'Range mede caixas de texto; baseline e caixa de glifo são estimativas de TextMetrics.',
        internals:m.internals.map(c=>({ selector:selector(c.element), level:componentMap.get(c.element)?.level,
          parts:c.parts.map(p=>({ type:p.type,text:p.text,level:(componentMap.get(c.element)?.level||0)+1,inferred:!!p.inferred,bounds:p.bounds,baselineApprox:p.baselineApprox,inkTopApprox:p.inkTopApprox,inkBottomApprox:p.inkBottomApprox })) })) };
    },
    measurements() {
      const m = measure();
      return { controls:m.controls.length, textDelta:m.textDelta, toolbarDelta:m.toolbarDelta, actionDelta:m.actionDelta, composerDelta:m.composerDelta,
        components:m.components.map(c => ({ label:c.name, type:c.type, level:c.level, parent:c.parent ? componentMap.get(c.parent)?.type : null, x:round(box(c.element).x), y:round(box(c.element).y), width:round(box(c.element).width), height:round(box(c.element).height) })) };
    },
    remove() {
      resizeObserver.disconnect(); mutationObserver.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('scroll', schedule, true);
      document.removeEventListener('transitionend', schedule, true);
      document.removeEventListener('pointerover', inspect, true);
      cancelAnimationFrame(frame);
      guideStyle.remove(); guides.remove(); panel.remove();
      if (window.VisualInspector===api) delete window.VisualInspector;
      options.onRemove?.();
    }
  };
  window.VisualInspector=api;
  draw();
  return api;

}

window.VisualInspector = installVisualInspector();
