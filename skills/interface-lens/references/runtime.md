# Runtime de inspeção

`scripts/inspect.js` instala `window.VisualInspector`. Reexecutar remove a instância anterior antes de instalar outra. Veja [agentes.md](agentes.md) para carregar o arquivo em cada harness.

O runtime não envia dados nem persiste preferências. Os retornos são locais e podem incluir textos visíveis. Escolha o que salvar; não publique conteúdo de sessões reais como exemplo do projeto.

## API

| Chamada | Retorno |
| --- | --- |
| `report({ maxFindings })` | Texto curto com tecnologias, tema, tokens, componentes, cobertura e achados. Ponto de partida para o agente. |
| `context()` | O contexto do produto em dados. Formato abaixo. |
| `audit()` | `findings`, `coverage`, `tolerancePx` e `internals` (partes de texto e ícone de cada controle). `status: "heuristic"` é deliberado. |
| `measurements()` | Componentes, níveis, nome de framework e retângulos em pixels CSS. |
| `snapshot()` | Rota, viewport, componentes com retângulo e estilo, e achados. É JSON: guarde no agente para sobreviver a recargas. |
| `diff(antes, depois?)` | `added`, `removed`, `moved`, `resized`, `restyled`, `unchanged` e `findings` (`resolved`, `introduced`, `remaining`). Sem `depois`, compara com o estado atual. |
| `select(seletor)` | Fixa a seleção e devolve o retângulo; `select(null)` volta a seguir o ponteiro. Aceita `host >>> interno` para shadow roots abertos. |
| `toggleGuides()`, `togglePanel()` | Mostra ou oculta as guias e o painel. Devolvem o novo estado. |
| `movePanel(x, y)` | Posiciona o painel; sem argumentos, devolve o posicionamento automático. |
| `remove()` | Desfaz a injeção, listeners e observers. Não toca os elementos originais. |

Compare `snapshot()` e `diff()` na mesma rota, viewport e posição de rolagem; `viewportChanged` avisa quando não é o caso. A chave de cada componente é seu seletor, então inserir irmãos antes de um elemento sem `id` nem `aria-label` pode trocá-la.

## Achados

Cada achado traz `rule`, `selector` (único no documento), `bounds`, `deltaPx`, `confidence` e `message`.

- `medido`: geometria lida diretamente, como um ícone fora do centro da própria caixa.
- `candidato`: hipótese que pede comparação visual. A referência vem dos irmãos ou de uma recomendação pública, nunca de um tamanho inventado.
- `requisito`: regra que o adaptador declarou.

| Regra | O que compara |
| --- | --- |
| `icone-texto-y`, `icone-botao-x`, `icone-botao-y`, `conteudo-botao-x` | Centro de ícone e texto dentro do controle. |
| `icone-slot-x`, `icone-slot-y` | Ícone dentro de uma caixa flex ou grid centralizada. |
| `componente-linha-y` | Componente fora do eixo de uma linha flex centralizada. |
| `ritmo-gap` | Espaço entre irmãos repetidos, contra o espaço da maioria. |
| `borda-inicial` | Onde o conteúdo começa em irmãos empilhados. |
| `dimensao-irmaos` | Altura de controles irmãos na mesma linha. |
| `raio-concentrico` | Raio interno contra o raio do contêiner menos o recuo, quando o filho está na zona da curva. |
| `texto-cortado` | Texto escondido por `overflow` sem reticências nem `line-clamp`. |
| `contraste-texto` | Razão WCAG 2 entre texto e fundo; 4.5:1, ou 3:1 para texto grande. Uma ocorrência por par de cores. |
| `alvo-minimo` | Alvo de clique menor que 24×24 px (WCAG 2.2, 2.5.8). Links em linha e alvos ampliados por pseudo-elemento ficam de fora. |
| `controle-sem-nome` | Controle só com ícone, sem `aria-label`, `aria-labelledby` ou `title`. |
| `esquema-nativo` | Tema escuro sem `color-scheme: dark` em `html`. |
| `padrao-width`, `padrao-height` | Dimensão declarada em `cohorts`. |
| `coluna-titulos`, `centro-toolbar`, `altura-toolbar`, `coluna-acoes`, `sombra-prompt` | Regiões declaradas em `selectors` e `requirements`. |

Irmãos são comparados quando o contêiner tem ao menos três filhos visíveis da mesma tag, em uma única linha ou coluna; `div` e `span` também precisam ter as mesmas classes. Só há referência quando a maioria concorda.

## Contexto

`context()` devolve:

- `technologies`: `{ name, category, version, evidence }`. Só entra o que deixou evidência no DOM, nas globais ou nos tokens.
- `theme`: `appearance` (medida no fundo da página), `colorScheme`, `metaColorScheme`, `prefersColorScheme`, `usesLightDark`, `themes`, `local`, `active` e `storage`.
  - Cada tema traz `name`, `selector`, `mechanism` (`classe`, `atributo` ou `media query`), `target`, `active`, `tokens` e `values` (os valores declarados naquele tema).
  - `local` lista escopos com nome de tema aplicados só a um elemento interno.
  - `storage` lista chaves de `localStorage` com nome de tema e valor curto.
- `tokens`: `total`, `colors`, `radius`, `spacing`, `typography`, `shadow`, `motion`, `other`, `omitted` e `stylesheets` (`read`, `blocked`). Cada cor traz `name`, `value`, `hex` no tema ativo, `format` quando o token guarda só canais, `themed` (muda por tema) e `used` (aparece na tela). As usadas e as que mudam por tema vêm primeiro.
- `palette`: cores em uso com contagem por papel (`text`, `background`, `border`) e os `tokens` de mesmo valor. Lista vazia em `tokens` indica cor escrita à mão.
- `typography` e `radii`: famílias, tamanhos, pesos e raios em uso, por frequência.
- `components`: nomes vindos de React, Vue, Svelte, `data-slot`, `data-component` e elementos customizados, com contagem, origem e um seletor de exemplo.

Um tema é reconhecido quando um seletor simples com nome de tema (`.dark`, `[data-theme="..."]`) redefine cores da raiz. Temas com nomes fora desse padrão não aparecem; confirme no código. O runtime só lê: para ver outro tema, use o controle do produto ou, em um mock, aplique o seletor informado em `target` e restaure depois.

## Painel

O painel fica em um shadow root, então o CSS da página não o altera. Arraste pelo cabeçalho; duplo clique devolve o posicionamento automático, que procura o canto que menos cobre controles. Com o foco na alça, as setas movem 16 px e `Shift` com setas move 64 px.

- **Inspeção**: hierarquia, tamanho, posição, cores com o token correspondente, fonte, contraste, raio, padding e seletor do componente sob o ponteiro.
- **Achados**: clique em um item para fixar o alvo; clique de novo para soltar.
- **Contexto**: tecnologias, tema, tokens de cor, cores sem token, tipografia e componentes.

O botão de comparação só aparece quando um estilo de mock é fornecido. Para capturas limpas, use `togglePanel()` ou instale com `panel: false`.

## Adaptar ao produto

A identificação semântica funciona sem configuração. Adaptadores associam regiões e regras que só o produto conhece. Use seletores observados no DOM e callbacks de leitura.

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

- `panel: false`: instala sem o painel; a API e as guias continuam.
- `rules`: desliga regras pelo nome, por exemplo `{ 'alvo-minimo': false }`.
- `nameAttributes`: atributos do produto que nomeiam controles, por exemplo `['data-tooltip']`. Entram no nome do componente e no seletor.
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

O runtime considera visibilidade, clipping, semântica, texto renderizado e ícones, inclusive dentro de shadow roots abertos. As leituras de geometria são compartilhadas somente dentro de cada snapshot. Só a área visível é auditada: role a página e repita para cobrir o restante.

Um candidato de centro texto/ícone merece comparação visual. Uma letra com descendente não tem a mesma massa visual de um símbolo simétrico. A caixa de layout, o desenho visível e a baseline respondem perguntas diferentes; não corrija uma delas cegamente para zerar outra.

O relatório não decide a intenção do designer nem comprova conformidade completa de acessibilidade. Inspecione a tela final e registre os estados efetivamente cobertos.
