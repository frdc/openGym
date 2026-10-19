# Diário do projeto

## 2026-10-19 - Pendências de uso do relógio e do celular

Contexto:
O usuário esclareceu por voz que a falha ocorre com a **tela do celular desligada**: Iniciar no relógio não responde. Pediu execução independente no relógio, sincronização ao reabrir o celular e implementação direta, sem novas confirmações.

Próximos passos:
- [x] Salvar no relógio e iniciar o timer de descanso como parte da mesma ação.
- [x] Fazer o relógio funcionar de forma independente (standalone), sem depender do celular para começar ou pausar o exercício.
- [x] Esclarecer o relato sobre foreground: o cenário é o celular com a tela desligada. A dependência de uma resposta recente do WebView e da leitura cardíaca foi reproduzida no emulador.
- [x] Depois das correções, abrir o [editor de layout do relógio](../frontend/tools/wear-layout/README.md).

Implementação concluída na branch `codex/wear-standalone`:
- [Plano](superpowers/plans/2026-10-19-wear-standalone.md) e [contrato](superpowers/specs/2026-10-19-wear-standalone-design.md) registrados.
- O treino preparado no celular passa a fornecer a sequência de séries ao relógio, que salva ações localmente antes de confirmar e pode avançar sem conexão.
- A sincronização usa identificadores estáveis e confirmações persistidas para evitar duplicação; alterações concorrentes ou troca de sessão preservam as ações locais como conflito.
- O sensor cardíaco passa a ser opcional para iniciar. A criação/seleção de um novo treino e séries avançadas continuam no fluxo do celular.
- O descanso usa o horário absoluto de término, para não reiniciar a contagem ao reconectar.

Evidências:
- Teste da interface primeiro falhou ao iniciar desconectado; após a integração passou: iniciar, concluir, descanso, pausar/retomar, pular e iniciar a próxima série, sem sensor cardíaco.
- Testes reais de SharedPreferences verificaram restauração e falha de escrita; os testes Java e as compilações iniciais dos dois APKs passaram.
- A revisão independente identificou e levou à correção de três casos: início sem série anterior ao importar descanso, alterações de descanso no celular e limite comum de 15 minutos. Regressões observaram a falha e passaram após a correção.
- Suíte web final: **356 arquivos / 3.905 testes aprovados**. Testes Java: **6 no celular + 40 no relógio**. No emulador, 27 de 28 passaram na suíte completa; o teste restante precisava da permissão de notificação, e passou junto com o outro teste de background após concedê-la somente no emulador.
- Seis testes de scripts, 17 idiomas/2.031 chaves, builds web/mobile, verificação dos bundles e ambos os APKs aprovados. Há avisos preexistentes de React e tamanho de chunks, sem falhas.
- Editor iniciado em segundo plano, HTTP 200 verificado e abertura solicitada no Codex: `http://127.0.0.1:5178/tools/wear-layout/index.html`. O painel retornou `queued`, para mostrar a página ao voltar à tarefa. O emulador criado para os testes foi fechado ao final.
- Nenhum dispositivo físico está conectado nesta execução. A evidência atual é de testes automatizados e emulador.
