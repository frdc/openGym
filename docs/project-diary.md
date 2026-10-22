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
