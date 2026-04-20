# Objetivo Principal
Você vai atuar como um Desenvolvedor Frontend e UI/UX Sênior. Sua tarefa é refatorar o frontend atual do sistema para torná-lo 100% responsivo e otimizado para dispositivos móveis (smartphones e tablets), sem quebrar a versão desktop.

# Diretrizes de Design (CRÍTICO)
- **Zero "Aspecto de IA":** A interface não deve parecer um template genérico gerado por IA. Mantenha a identidade visual autêntica e o design refinado. 
- As adaptações para mobile devem parecer naturais, intencionais e projetadas por um humano. Não apenas "esprema" os componentes; repense a usabilidade deles para telas menores.

# Diretrizes Técnicas
1. **Layout e Grids:**
   - Converta larguras fixas para relativas (`%`, `vw`, `rem`).
   - Altere a direção de `flex` e `grid` (ex: de lado a lado no desktop para empilhado em coluna no mobile em resoluções `< 768px`).
   
2. **Navegação e Menus:**
   - Adapte menus complexos e sidebars para um "Menu Hambúrguer" (Drawer) lateral ou uma "Bottom Navigation Bar" no mobile.
   - Garanta que o cabeçalho (Header) fique enxuto, mostrando apenas a logo, o menu e a ação principal.

3. **Tabelas e Listas de Dados:**
   - Nunca deixe tabelas quebrarem o layout (evite rolagem horizontal na página inteira).
   - Solução A: Adicione um wrapper com `overflow-x-auto` apenas na tabela.
   - Solução B (Preferencial): Em telas muito pequenas, converta as linhas da tabela em um layout de "Cards" verticais.

4. **Modais e Formulários:**
   - Modais devem ocupar de 95% a 100% da largura da tela no mobile, com rolagem interna adequada (`overflow-y-auto`).
   - Campos de formulário devem ocupar 100% da largura em telas pequenas.

5. **Interatividade (Touch Targets):**
   - Aumente a área clicável de botões, links e ícones para no mínimo `44x44px` para facilitar o toque com os dedos.
   - Revise e otimize o tamanho das fontes, paddings e margins. Remova espaços em branco excessivos no mobile para melhor aproveitamento da tela, mas mantenha a interface limpa e legível.

# Restrições de Código
- Foque estritamente na camada de apresentação, classes CSS e estilos UTILIZE TAILWINDCSS.
- **NÃO** altere a lógica de negócios, hooks ou o estado dos componentes no React, a menos que seja estritamente necessário para o comportamento do menu/layout responsivo.

# Plano de Execução (Faça em etapas)
Para garantir a estabilidade do sistema, não reescreva tudo de uma vez. Siga os passos abaixo, me enviando o código e aguardando minha aprovação a cada etapa:

1. **Passo 1:** Refatorar o Layout Principal (Header, Footer, e Container principal da página). Aguarde aprovação.
2. **Passo 2:** Refatorar a Navegação (Sidebars, Menus e roteamento visual). Aguarde aprovação.
3. **Passo 3:** Refatorar Listas, Tabelas e Cards de conteúdo. Aguarde aprovação.
4. **Passo 4:** Refatorar Formulários, Modais e pop-ups. Aguarde aprovação.

Responda apenas confirmando que compreendeu as regras de design e o plano de execução, e inicie a análise do Passo 1 com base nos arquivos do projeto.