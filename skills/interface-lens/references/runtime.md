# Runtime de inspeção

Execute `scripts/inspect.js` como Snippet ou pelo mecanismo de injeção autorizado do navegador. Ele instala `window.VisualInspector`. Reexecutar remove a instância anterior antes de instalar outra.

O runtime não envia dados nem persiste preferências. `audit()` e `measurements()` retornam dados locais que podem incluir textos visíveis. Escolha o que salvar; não publique conteúdo de sessões reais como exemplo do projeto.

## Consultar e selecionar

- `measurements()` retorna componentes, níveis e retângulos em pixels CSS.
- `audit()` retorna candidatos, tolerância, cobertura e partes internas. A propriedade `status: "heuristic"` é deliberada.
- `select(selector)` fixa a seleção para capturar uma evidência estável; `select(null)` libera a seleção.
- `toggleGuides()` controla a camada visual.
- `remove()` desfaz a injeção, listeners e observers. Não remove os elementos originais.

O painel permite consultar o relatório, inclusive com as guias ocultas. O botão de comparação só aparece quando um estilo de mock é fornecido.

## Adaptar ao produto

A identificação semântica funciona sem configuração. Adaptadores são úteis para associar regiões e regras que só o produto conhece. Use seletores observados no DOM e callbacks de leitura.

```js
const style = document.getElementById('meu-mock');
installVisualInspector({
  mockStyle: style,
  selectors: {
    sidebar: 'aside',
    rows: '[data-row]',
    label: '[data-label]',
    composer: '[data-composer]',
    toolbar: '[data-toolbar]',
    components: '[data-row], [data-composer]',
    observe: 'main, aside'
  },
  describe(element) {
    if (element.matches('[data-row]')) return {type: 'Linha'};
    return null;
  },
  cohorts: [{
    name: 'Controles compactos',
    selector: '[data-toolbar] > button',
    height: 32 // Exemplo: obter o valor do padrão real do produto.
  }],
  onRemove() { style?.remove(); }
});
```

Opções adicionais, conforme necessidade:

- `selectors.scope`: prefixo de seletor para localizar controles na região correta.
- `selectors.actions`, `selectors.headerActions`: ações que devem compartilhar um eixo horizontal.
- `selectors.rail`: navegação lateral cuja linha central deve ser desenhada.
- `selectors.icons`: hosts de ícones adicionais aos elementos `svg` e `img`.
- `labelForRow(row)`: resolve o elemento de texto quando um seletor não basta.
- `toolbarRoot(composer)`: resolve o contêiner real da barra, preservando os botões condicionais que ela contém.
- `requirements.noComposerShadow`: requisito explícito para remover uma sombra. Não é regra geral de design.
- `tolerancePx`: tolerância geométrica em pixels CSS; padrão de 1 px.
- `cohorts`: seletores e dimensões esperadas, com `width` e/ou `height`, quando há um contrato visual confirmado.

Não use coortes para forçar tamanhos iguais em controles com papéis diferentes. Botão principal, avatar, ícone de navegação e marcador de expansão podem ter escalas próprias.

## Interpretação

O runtime considera visibilidade, clipping, semântica, texto renderizado e ícones. As leituras de geometria são compartilhadas somente dentro de cada snapshot. Os centros de ícones em caixas flex/grid também são medidos, inclusive com `place-items: center`.

Um candidato de centro texto/ícone merece comparação visual. Uma letra com descendente não tem a mesma massa visual de um símbolo simétrico. A caixa de layout, o desenho visível e a baseline respondem perguntas diferentes; não corrija uma delas cegamente para zerar outra.

O relatório não decide a intenção do designer nem comprova conformidade completa de acessibilidade. Inspecione a tela final e registre os estados efetivamente cobertos.
