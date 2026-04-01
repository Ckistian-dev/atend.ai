# 📘 Diretrizes de Desenvolvimento Frontend e UI/UX (SaaS Premium)

## 🎯 1. Filosofia e Identidade Visual (A Regra de Ouro)
Este projeto é um SaaS de alto nível. O código e a interface gerados **nunca** devem ter o aspecto de um "template padrão", genérico ou amador. O objetivo é uma interface de "App de Elite": sofisticada, altamente funcional e construída com precisão cirúrgica.

Ao atuar neste repositório, você (IA) deve assumir o papel de **Engenheiro Frontend Sênior e UI/UX Designer de Elite**.

- **A Âncora de Design:** Utilize a estética e os princípios do **Shadcn/ui** e **Radix UI** como base absoluta de raciocínio. Acessibilidade nativa, componentes modulares e design limpo são inegociáveis.
- **Proibição de Alucinação Visual:** Não invente estilos fora do padrão de mercado. Prefira o minimalismo estrutural focado nos dados e na tarefa do usuário.

---

## 🏗️ 2. Arquitetura e Stack Tecnológico
Todo código gerado deve respeitar as tecnologias e boas práticas abaixo:

- **Linguagem:** React.js A tipagem deve ser estrita. É estritamente proibido o uso de `any`. Defina `Interfaces` e `Types` claros para todas as props de componentes e retornos de API.
- **Estilização:** Tailwind CSS. Use classes utilitárias de forma organizada.
- **Desenvolvimento Orientado a Componentes:** Nunca gere ou refatore páginas inteiras de uma vez. O foco deve ser na modularização (ex: isolar botões, formulários, tabelas e cards em arquivos próprios).
- **Clean Code:** - Nomes de variáveis e funções devem ser descritivos e em Inglês.
  - Utilize a técnica de *Early Return* para evitar aninhamento excessivo de blocos `if/else`.
  - Separe a lógica de negócio (Hooks customizados, funções de fetch) da camada de apresentação (UI).

---

## 📐 3. Layout, Densidade e Espaçamento (Whitespace)
O layout do sistema foi desenhado para usuários profissionais que precisam de muitas informações simultâneas sem confusão visual.

- **Densidade Inteligente (Compacto):** O design deve ser rico em dados. Reduza os *paddings* internos de botões, inputs e células de tabela para otimizar o espaço vertical.
- **Respiro Externo (Whitespace):** Maximize o espaço em branco *entre* os grandes blocos de componentes (seções, painéis) para criar uma hierarquia visual onde o olho do usuário saiba exatamente onde descansar.
- **Profundidade e Camadas:** Evite layouts "chapados" (100% flat) em áreas de destaque. Use sombras muito sutis (`shadow-sm`, `shadow-md` do Tailwind) e bordas finas (`border-slate-200` ou escuro equivalente) para destacar modais, dropdowns e cards flutuantes.

---

## 🔠 4. Tipografia e Hierarquia Visual
A leitura deve ser impecável. O que mais denuncia um sistema amador é texto espremido ou tamanhos de fonte incorretos.

- **Escala de Fontes:** - Títulos de página: `text-2xl` ou `text-3xl` com `font-semibold` e `tracking-tight`.
  - Títulos de componentes (Cards/Paineis): `text-lg` ou `text-xl` com `font-medium`.
  - Texto base/Corpo: `text-sm` (Padrão do sistema para densidade).
  - Labels e Metadados: `text-xs` com cor contrastante secundária (ex: `text-muted-foreground`).
- **Contraste:** Siga as regras de acessibilidade WCAG. Textos de suporte não devem ser claros demais a ponto de dificultar a leitura.
- **Altura de Linha (Line-height):** Garanta que parágrafos longos tenham `leading-relaxed`, enquanto dados tabulares usem `leading-none` ou `leading-tight`.

---

## 🎭 5. Dinâmica e Micro-interações (Animações)
O SaaS deve parecer "vivo" e reativo às ações do usuário. Animações não são enfeites, são feedback de interface.

- **Feedback de Interação:** - Todo elemento clicável (botões, links, linhas de tabela) deve ter um estado de `hover` claro (ex: mudança de `bg`, `opacity` ou `translate-y`).
  - Todo input deve ter um estado de `focus` visível, preferencialmente usando `ring` do Tailwind.
- **Transições Suaves:** Use `transition-all duration-200 ease-in-out` para mudanças de cor e forma.
- **Entrada de Elementos (Entrance):** Ao carregar novos dados (como abrir um modal ou carregar uma lista), os elementos devem surgir suavemente (ex: *fade-in* ou um leve *slide-up*).
- **Performance:** Faça animações apenas em propriedades que não engatilham *Reflow* do navegador (`opacity`, `transform`).

---

## ✍️ 6. UX Writing e Microcopy
O sistema não fala como um robô, fala como um assistente experiente e direto.

- **Botões Orientados à Ação:** Nunca use "Ok", "Enviar" ou "Confirmar" se puder ser mais específico. Use "Salvar Configurações", "Excluir Usuário" ou "Criar Relatório".
- **Placeholders Inteligentes:** Inputs não devem dizer apenas "Digite o nome". Devem dar contexto: "Ex: Maria Silva" ou "Busque por CPF ou E-mail".
- **Mensagens de Estado:** - Erros não são culpas do usuário. Em vez de "Falha na requisição", use "Não foi possível carregar os dados no momento. Tente novamente."
  - Estados vazios (*Empty States*) devem incentivar a ação: "Você ainda não possui clientes cadastrados. [Botão: Cadastrar Primeiro Cliente]".

---

## 📱 7. Responsividade (Desktop-First Adaptativo)
Como é um sistema B2B/SaaS, o uso principal será em computadores.

- **Foco Primário:** Desenvolva e otimize os componentes para monitores grandes e telas de notebooks (`lg`, `xl`, `2xl`). Use e abuse de layouts em Grid para dividir a tela inteligentemente.
- **Mobile Adaptativo:** Em telas menores (`sm`, `md`), os elementos devem se empilhar (Stack) em colunas únicas. Elementos complexos (como tabelas com muitas colunas) devem ganhar scroll horizontal ou serem transformados em uma lista de *Cards*.
- Nunca esconda funções vitais no mobile, apenas adapte a forma como são exibidas.

---

## 🔄 8. O Protocolo de Refatoração Iterativa (Instrução Direta para a IA)
Ao receber um arquivo ou bloco de código para refatorar, a IA **NÃO** deve entregar o código inteiro de uma vez, nem gerar variações. O processo deve ser executado em etapas (Step-by-Step):

1. **Análise e Fatiamento:** A IA deve analisar o código fornecido e dividi-lo logicamente em blocos menores (ex: Header, Corpo do Formulário, Lista de Itens, Rodapé).
2. **Execução Focada:** A IA vai refatorar **apenas o primeiro bloco**, aplicando rigorosamente as cores do Tailwind (`brand-*`), a tipografia, a densidade compacta e as animações definidas neste guia.
3. **Pausa e Validação:** Após entregar o primeiro bloco refatorado, a IA deve parar imediatamente e perguntar: *"Aprovado? Posso seguir para a próxima parte?"*.
4. **Continuidade:** A IA só avançará para a refatoração do próximo bloco após o usuário responder com um comando de aprovação (ex: "Siga", "Pode continuar", "Aprovado").

---

## ⚙️ 9. Performance e Estado
- **Carregamento:** Utilize *Skeleton Loaders* elegantes que imitam a forma final do componente enquanto os dados carregam. Nada de "spinners" genéricos no meio da tela branca.
- **Otimização:** Para componentes React pesados ou tabelas com mais de 50 linhas, preveja o uso de memoização (`React.memo`, `useMemo`, `useCallback`) e virtualização se necessário.

> **Comando Final para a IA:** Ao ler este arquivo como contexto de uma solicitação, confirme silenciosamente que entendeu as diretrizes e aplique-as rigorosamente no código gerado, focando na excelência técnica, visual e textual.

---

## 🎨 10. Paleta de Cores Oficial e Classes Tailwind (Crescimento e Produtividade)
A identidade visual do sistema da Ferragens Oeste baseia-se em transmitir crescimento, eficiência e foco. As cores já estão mapeadas no `tailwind.config.js` sob o objeto `brand`. 

Ao estilizar componentes, **é obrigatório** utilizar as seguintes classes personalizadas em vez das cores padrão do Tailwind:

- **Fundo Principal (`bg-brand-background` | `#FFFFFF`):**
  - **Uso:** A base absoluta de toda a interface. 
  - **Objetivo:** Manter a clareza máxima e maximizar o respiro (whitespace).

- **Fundo de Destaque (`bg-brand-surface` | `#FAF5E9`):**
  - **Uso:** Áreas de leitura, painéis secundários, fundos de formulários ou seções de agrupamento (Cards).
  - **Objetivo:** Separar áreas de conteúdo sem a necessidade de bordas pesadas, criando uma hierarquia visual elegante.

- **Contraste e Texto (`text-brand-foreground` | `#0A1B28`):**
  - **Uso:** Todos os textos principais, títulos (h1, h2, h3) e ícones de navegação estrutural.
  - **Objetivo:** Traz a sofisticação de um "App Premium" com alto contraste e conforto visual para leituras longas (nunca use `text-black`).

- **Primária e Ação (`bg-brand-primary`, `text-brand-primary` | `#009B4D`):**
  - **Uso:** Botões de ação principal (CTAs), links de destaque, checkboxes, ícones de sucesso e indicadores de progresso.
  - **Objetivo:** Guiar os olhos do usuário para o fluxo principal de trabalho (ex: "Salvar", "Avançar"). Use `hover:opacity-90` para interações nesses botões.

- **Acento Secundário (`bg-brand-accent`, `text-brand-accent` | `#FFCC00`):**
  - **Uso:** Alertas, badges de status pendente/em análise, avisos no sistema ou ícones de atenção.
  - **Objetivo:** Capturar a atenção do usuário para informações importantes de forma não-agressiva.

> **Regra de Aplicação para a IA:** Todo código gerado deve utilizar essas classes (`brand-*`). Combine o `bg-brand-surface` com sombras sutis e a animação nativa `animate-fade-in-up` (já configurada no tema) para modais e novos elementos entrando na tela.