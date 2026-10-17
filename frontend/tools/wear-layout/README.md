# Editor visual do relógio

Ferramenta local independente para ajustar as quatro telas do Wear OS. Usa a fonte Nunito, a textura e o contorno do botão presentes no aplicativo. A animação usa a mesma malha de 20 × 20 células e as mesmas equações de deformação do fundo nativo.

## Abrir

Execute `iniciar-editor.cmd` nesta pasta e abra:

http://127.0.0.1:5178/tools/wear-layout/index.html

O script usa o Vite já instalado em `frontend/node_modules`. Se o servidor já estiver aberto, basta acessar o endereço. Mantenha o terminal aberto durante a edição.

## Ajustar

- Escolha Treino, Descanso, Opções ou Carga.
- Clique e arraste um elemento, ou selecione-o pelo painel.
- Ajuste posição, tamanho, fonte e cores. As setas movem o elemento selecionado em 0,5 dp; Shift + seta move em 5 dp.
- Iniciar, Pausar e Confirmar compartilham o estilo do botão principal.
- Ative “Animar ondas” para conferir o fundo. Preferências de movimento reduzido são respeitadas.
- “Desfazer” e “Restaurar” permitem recuperar os ajustes.

As alterações são salvas automaticamente no armazenamento deste navegador. “Exportar ajustes” gera `opengym-wear-layout.json`; “Importar” recupera um arquivo exportado. “Salvar imagem” exporta a tela sem as guias de edição.

## Aplicação ao APK

A ferramenta é uma prévia visual editável; alterar seus controles não modifica o Java do relógio automaticamente. O JSON exportado registra cores, estilo comum do botão, coordenadas por tela, fontes e conteúdo de exemplo. Entregue esse arquivo ao Codex para aplicar os ajustes ao app e conferir as capturas nativas antes de gerar o APK.

As coordenadas usam uma referência de 225 dp. A opção de 192 dp mostra uma versão proporcional da prévia; o app nativo também possui regras específicas para telas compactas, que devem ser verificadas na aplicação dos ajustes. O navegador e o Android podem diferir na métrica do texto.
