# Diário do projeto

## 2026-10-21 - Visualizador de movimento no PC

- Trabalho anterior salvo no commit `77831066` e enviado para `frdc/openGym`, branch `codex/wear-standalone`, com autorização explícita do usuário. Limpeza de intermediários e log gerado liberou aproximadamente 186 MB, preservando APKs, evidências e configurações.
- [Visualizador local](../frontend/tools/wear-motion/README.md) em `http://127.0.0.1:5180`, iniciado por `npm run motion:viewer` na pasta frontend. Mostra orientação do relógio em 3D, calibração, gráficos dos sensores e gravação/exportação JSON local limitada a 30 minutos.
- Activity e socket exclusivos da versão debug; conexão via túnel ADB e servidor loopback, sem celular. Sensores liberados ao sair/encerrar; canais sem atualização expiram individualmente. Treinos e dados existentes preservados.
- Modelo exibe um antebraço com cotovelo fixo e comprimento ilustrativo. Não estima posição absoluta, distância percorrida ou postura do braço inteiro. Referencial é relativo à calibração; mudança do tronco exige recalibração.
- Validação: **29 testes Node, 51 unitários Wear, 5 instrumentados motion** aprovados, APKs debug e de testes compilados; suíte web existente com **356 arquivos / 3.905 testes** aprovada. Revisão independente aprovada após correções de encerramento concorrente e validade dos canais de sensores.
- Fluxo confirmado em emulador: conexão → calibração → mudança de orientação/sensores → rotação 3D → gravação e exportação de **7.262 amostras**, incluindo referência de calibração e unidades. Evidências locais em `frontend/android/wear/build/motion-evidence/` (ignoradas pelo Git).
- Usuário informou estar fora de casa. **A nova versão foi instalada apenas no emulador**; instalação e validação do visualizador no relógio físico continuam pendentes até ele estar acessível. APK pronto em `frontend/android/wear/build/outputs/apk/debug/wear-debug.apk`.

## 2026-10-21 - Instalação no celular e no relógio

- APKs atuais conferidos: bundle mobile idêntico à cópia Android e compilação `:app:assembleDebug :wear:assembleDebug` aprovada.
- Atualização de `com.fredc.opengym.test` via `adb install -r --user 0` concluída com Success no Galaxy S23 Ultra (SM-S918B) e no Galaxy Watch Ultra (SM-L705F), preservando os diretórios de dados existentes.
- Instalações confirmadas pelo novo `lastUpdateTime`; MainActivity no celular e WearActivity no relógio abertas com `Status: ok`. O relógio recebeu o layout corrigido. Esta etapa confirma instalação e abertura; não constitui um treino completo de validação em dispositivo físico.

## 2026-10-20 - Layout aprovado aplicado ao relógio

- Referência visual: [mockup de treino e descanso](../frontend/tools/wear-layout/mockup-rest.html), que substitui o desenho anterior para estas telas. [Plano concluído](superpowers/plans/2026-10-20-wear-approved-layout.md).
- Timer, repetições e carga mantêm a mesma posição nas duas fases. Descanso recebe Pular e +15 s discretos nas laterais; Opções sem fundo substitui os pontos de navegação, com retorno explícito nas configurações.
- A primeira implementação divergiu do mockup e foi considerada fiel prematuramente. A comparação enviada pelo usuário mostrou título truncado, deslocamentos e fonte incorreta. A correção usa a composição proporcional de 225 dp, inclusive em telas compactas, corrige os insets e o peso variável da Nunito, e separa a posição visual das áreas de toque sem sobreposição. Textos longos do botão principal se ajustam ao espaço da superfície curva.
- Validação: 40 testes unitários Wear e 28 instrumentados passaram. Os dois testes de geometria/estados visuais passaram também com densidade equivalente a 192 dp. Após o ajuste final de textos longos, APK recompilado e teste de estados visuais novamente aprovado. Capturas reais de treino e descanso em ambos os tamanhos foram inspecionadas lado a lado com a referência, usando dados iguais, batimentos simulados e fundo parado.
- Evidências locais em `frontend/android/wear/build/layout-evidence/comparison.html` e `comparison.png`; APK em `frontend/android/wear/build/outputs/apk/debug/wear-debug.apk`. As capturas são do emulador; nenhum relógio físico estava conectado para instalação.
- Contrato de sincronização e execução standalone preservados.

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

## 2026-10-21 - Quedas da conexão de movimento no relógio físico

- Usuário voltou para testar no Galaxy Watch Ultra (SM-L705F), confirmou que o modelo acompanha o movimento e relatou conexões intermitentes. Repositório permanece público, conforme sua decisão final.
- Logs reproduziram duas causas: iniciar com a tela apagada levava a Activity a pausar e fechar o socket; um envio bloqueado por 1.076 ms disparava o limite excessivamente curto de 1 segundo.
- Conectar agora acende a tela de sensores; a ação de encerramento não acorda o relógio. Envios bloqueados toleram até 10 segundos e a ponte aceita até 12 segundos sem quadros após o handshake. A pose ainda congela após 1 segundo sem dados frescos, e a fila permanece limitada à amostra mais recente. Mensagens de erro incluem a causa da interrupção.
- Regressões de tela apagada e leitura temporariamente bloqueada falharam antes das correções e passaram depois. **30 testes Node, 51 unitários Wear e 7 instrumentados motion** aprovados, APK compilado e instalado no relógio físico preservando os dados. A ponte também foi testada com uma pausa de 6,5 segundos seguida de recuperação e depois silêncio definitivo, que libera a conexão.
- Após a atualização, monitoramento físico de **60 segundos** recebeu **1.319 amostras**, uma única sessão, nenhum evento de desconexão e intervalo máximo de **630 ms** entre chegadas. Esse resultado confirma o intervalo observado; não equivale a um teste prolongado de rede nem mede a precisão espacial.
- Servidor local atualizado e visualizador aberto para o usuário recalibrar e continuar o teste. Evidências técnicas permanecem locais em `frontend/android/wear/build/motion-evidence/`, ignoradas pelo Git.

## 2026-10-21 - Reconexão e botão de sincronização do relógio

- Usuário relatou séries feitas offline que não eram registradas no celular e exercício acrescentado após concluir a sequência que não aparecia no relógio. Dispensou recuperação dos dados antigos e pediu sincronização manual sem perder dados do relógio.
- Hidratação do telefone agora responde indisponibilidade temporária; desmontar a ponte não encerra o treino. Reenvio idêntico após edição no celular é reconhecido sem reaplicar a série ou desfazer a edição. Recibos persistidos permitem trocar para a sequência com o novo exercício depois de confirmar o diário anterior.
- Botão **Sincronizar com o relógio** junto a **Abrir no relógio**, no treino ativo Android. Primeiro recebe as ações pendentes, depois envia a atualização e aguarda confirmação de aplicação. Conflitos preservam o diário e mostram aviso; batimentos ainda pendentes ficam na fila e são indicados separadamente. Os dois aplicativos precisam da atualização para usar o novo botão.
- Regressões reproduziram carregamento, ACK perdido, exercício novo e captura cardíaca tardia (pico de 155 mantido após completar o novo exercício). Revisão independente apontou falso sucesso após falha de gravação standalone; teste com SharedPreferences real falhou antes e passou após propagar a falha, incluindo repetição do mesmo snapshot.
- Validação: **358 arquivos / 3.914 testes web, 6 unitários do celular, 56 unitários Wear e 10 instrumentados no emulador** aprovados. Builds mobile e ambos os APKs debug aprovados, bundle Android idêntico ao mobile; 17 idiomas / 2.037 chaves conferidos. Avisos preexistentes de chunks/importação dinâmica, sem falha de build.
- **Usuário escolheu testar depois; nova versão ainda não instalada nos dispositivos físicos.** APKs em `frontend/android/app/build/outputs/apk/debug/app-debug.apk` e `frontend/android/wear/build/outputs/apk/debug/wear-debug.apk`. Sem alterações nos dados pessoais e sem recuperação antiga. O servidor do visualizador de movimento foi encerrado a pedido do usuário antes desta tarefa e continua fechado.

## 2026-10-21 - Atualização de sincronização instalada no relógio

- A pedido do usuário, APK Wear do commit `47e8c388` instalado no Galaxy Watch Ultra (SM-L705F) com `adb install -r --user 0`, sem limpar dados. Instalação retornou Success; `lastUpdateTime` mudou e `firstInstallTime` permaneceu igual. WearActivity aberta com `Status: ok`.
- Esta etapa confirma instalação e abertura no relógio; a sincronização completa ainda depende da atualização correspondente do celular e de teste entre os aparelhos. O celular não foi atualizado nesta etapa.

## 2026-10-21 - Atualização de sincronização instalada no celular

- APK Android correspondente ao commit `47e8c388` instalado no Galaxy S23 Ultra (SM-S918B), selecionado explicitamente pelo identificador ADB Wi-Fi. O aparelho `0123456789ABCDEF` foi excluído da operação conforme pedido do usuário.
- Atualização com `adb install -r --user 0` retornou Success, preservando os dados; `lastUpdateTime` avançou e `firstInstallTime` foi mantido. MainActivity aberta com `Status: ok`. Celular e relógio agora receberam a atualização; a validação física da sincronização entre eles continua pendente.

## 2026-10-21 - Teste físico de séries offline e batimentos

- Usuário autorizou explicitamente descartar uma série e duas capturas antigas de treino encerrado, que bloqueavam o sensor por `stale-context`. Somente essas filas foram removidas do relógio; permissão do sensor já estava concedida. Novo treino e batimentos ativados pelo usuário.
- App do celular forçado a parar. Usuário concluiu duas séries no relógio; antes da reabertura, celular mantinha 0/4 séries e nenhuma medição, enquanto o relógio guardava cinco ações e duas capturas com **224 leituras**. Coleta encerrada explicitamente para finalizar a recuperação do teste.
- Reabertura reproduziu conflito persistente, com dados preservados. Boot instala armazenamento do visitante antes de restaurar o perfil autenticado; a ponte publicava essa fase como pronta e podia rejeitar o diário com `stale-context`. Agora a autoridade da ponte aguarda `authReady`, e o relógio retoma o diário ao receber a sessão original com a mesma base válida. Outros perfis, bases divergentes e snapshots antigos permanecem bloqueados.
- Regressões JS e Wear falharam antes das correções e passaram depois. Revisão apontou gravação prematura da remoção do conflito; teste de falha na segunda gravação reproduziu o caso e passou após manter o bloqueio durável até validar stream/eventos.
- APKs corrigidos instalados no S23 Ultra e Watch Ultra sem limpar dados. **As mesmas duas séries foram importadas**: 2/4 concluídas, sem duplicação; todos os **27 + 197 pontos** do gráfico, contagens e picos conferidos contra as capturas anteriores. Médias conferidas na precisão de origem ou na normalização decimal prevista; limite de esforço conferido pelos timestamps persistidos dos eventos (diferença de 1 ms para o relógio monotônico em uma captura). Estado final do relógio: ACK das cinco ações, zero ações pendentes, zero capturas pendentes e nenhum conflito.
- Validação automatizada: **358 arquivos / 3.916 testes web**, **6 unitários do celular + 60 Wear**, build mobile com cópia Android idêntica e ambos os APKs aprovados. Evidências do teste permanecem locais em `frontend/android/wear/build/heart-debug/`, ignoradas pelo Git; medições e dados pessoais não foram adicionados ao repositório.

## 2026-10-28 - Comparação com a main original do OpenGym

- Usuário voltou a relatar falhas de sincronização e pediu avaliar as novidades da main original, inclusive relógio. Fetch de `origin/main` e da original `DuarteSantos8/openGym`; original fixada em `5fdb229fe40d2299ba0c82b84c86259d73944aba`, versão 1.4.3. Suporte atual é Apple Watch; Wear OS consta no roadmap para dezembro, sem módulo Wear Android na árvore consultada.
- [Relatório de compatibilidade e prioridades](dev/2026-10-28-upstream-watch-sync-review.md): adaptar fila nativa no celular, conciliação por série, eventos atrasados para treinos salvos e casos de retomada/reinstalação. Conservar isolamento por dono/sessão, recibos atômicos e nossas curvas cardíacas. Health Connect é uma recuperação adicional, condicionada a permissão e amostras disponíveis.
- Três reproduções sintéticas no helper atual confirmaram `baseline-conflict` após editar outra série, `state-conflict` entre lotes com edição no celular e `stale-context` após mover o treino ao histórico. Estado preservado nos três casos. São limitações reproduzidas, ainda não a causa confirmada do relato novo. Execução por Vitest: **3/3 aprovados**; tentativa direta por Node não executou o helper porque a cadeia de imports usa `import.meta.glob` do Vite.
- Nenhum merge ou mudança funcional aplicada; nenhum aparelho ou dado pessoal foi alterado nesta análise. A incorporação exige adaptar os mecanismos, pois a original usa Swift/WatchConnectivity, servidor próprio e formato cardíaco diferente. A fila original também tem descarte por limite e deduplicação fora da transação, que não devem ser copiados para nossa garantia de preservação.

## 2026-10-28 - Reconciliação por série, histórico tardio e inbox Android

Contexto: usuário autorizou implementar os mecanismos selecionados da main original para melhorar a sincronização de séries e batimentos offline.

Alterado:
- Manifestos e recibos privados no envelope do dono, gravados junto ao estado. IDs estáveis distinguem entradas/séries repetidas; merge por campo conserva mudanças independentes e bloqueia alvos ambíguos ou valores incompatíveis.
- Dados atrasados entram no treino histórico por ID e início, preservando o novo treino ativo e seus timers. Vínculos cardíacos identificam a entrada, série e lado; curvas finalizadas permanecem intactas.
- Inbox nativa AtomicFile guarda diário e medições antes de chamar o WebView. Limites explícitos de 512 itens/8 MiB; retirada só do conteúdo exato após importação confirmada. Inbox e arquivos de estágio excluídos de backup/transferência Android.
- Relógio negocia autorização exata e recibos históricos. A projeção anuncia 96 bases recentes mais a pedida, sem apagar manifestos antigos; o custo para uma base antiga é uma consulta adicional.

Verificação:
- Revisão independente encontrou vínculo cardíaco por timestamp após cópia de série e timer de superset perdido no segundo lote. Ambos foram reproduzidos antes das correções e passaram depois; cobertos também alvo substituído ao vivo, reordenação e timer independente do celular.
- Resultado final: **361 arquivos/3.942 testes web**, **9 unitários do celular + 64 Wear**, **10 instrumentados Wear + 3 celular**, scripts de build **6/6**, traduções **17 idiomas/2.037 chaves**, builds e bundles aprovados. Notificação do teste de background precisou ser habilitada somente no emulador; os três testes do celular passaram novamente no APK final.
- [Contrato, cenários e limites da evidência](dev/2026-10-28-wear-reconciliation-verification.md). Nenhum achado da revisão foi deixado para depois. Fontes na branch `codex/wear-standalone`; sem merge da main original ou mudança na visibilidade do repo.

Próximo teste: atualizar os dois aparelhos quando reaparecerem no ADB, repetir série offline e comparar curva no histórico com outro treino aberto. Nesta execução só os emuladores receberam os APKs; nenhum dado pessoal foi limpo. O servidor do visualizador permanece fechado. APKs finais preservados nos caminhos habituais de `frontend/android/app` e `frontend/android/wear`.

## 2026-10-28 - Reconciliação instalada no celular e no relógio

- A pedido do usuário, os APKs validados da entrega `0131fc37a` foram instalados no Galaxy S23 Ultra (SM-S918B) e no Galaxy Watch Ultra (SM-L705F), selecionados por modelo e serial antes da operação. O dispositivo `0123456789ABCDEF` permaneceu excluído.
- Ambos os `adb install -r --user 0` retornaram Success; `firstInstallTime` permaneceu igual e `lastUpdateTime` avançou. SHA-256 dos APKs instalados conferidos com os artefatos validados. Nenhuma limpeza de dados ou de pendências foi executada.
- MainActivity e WearActivity abertas com Status ok, com processos em execução após a atualização. Evidências limitadas a instalação, pacote e abertura ficam em `frontend/android/app/build/install-evidence-20261028/`, ignoradas pelo Git.
- A sincronização de um treino offline e a integridade das curvas entre os aparelhos ainda precisam do teste de uso. Esta instalação não é evidência de um treino físico completo.
