# Comparação com a main original: relógio e sincronização

## Escopo e revisão consultada

Pedido: investigar o que aproveitar do OpenGym original diante de novas falhas de sincronização com o relógio.

- Nossa branch: `codex/wear-standalone`, `3c99a5c6`.
- `origin/main` do fork `frdc/openGym`: `49077564`, consultada por fetch; não contém nossas alterações posteriores do relógio. A `main` local também contém dois commits próprios já ancestrais da branch atual.
- Original: [DuarteSantos8/openGym](https://github.com/DuarteSantos8/openGym), `main` fixada em [`5fdb229fe40d2299ba0c82b84c86259d73944aba`](https://github.com/DuarteSantos8/openGym/commit/5fdb229fe40d2299ba0c82b84c86259d73944aba), publicada em 27/10/2026 no horário de Cuiabá. `frontend/package.json`: 1.4.3.
- Base comum: `ce30c7304bdeb66a6eb4a3d14821a06035523b06`. Há 45 commits exclusivos da nossa branch e 913 exclusivos da original; contagem inclui commits de merge.
- Nenhum merge, alteração de protocolo, instalação ou operação sobre dados dos aparelhos foi feito nesta análise.

## O suporte a relógio da original

O relógio disponível nessa revisão é **Apple Watch**, com Swift/WatchConnectivity e núcleo testável `WatchCore`. O README coloca **Wear OS no roadmap v1.4.6, dezembro de 2026**; é planejamento, não uma implementação Android pronta para instalar.

Fonte: [README da revisão consultada](https://github.com/DuarteSantos8/openGym/blob/5fdb229fe40d2299ba0c82b84c86259d73944aba/README.md), `frontend/ios/App/Watch`, `WatchCore` e `App/WatchBridgePlugin.swift`. A árvore Android possui Health Connect, mas não o módulo Wear que implementamos.

## O que vale adaptar

| Mecanismo | Evidência na original | Aplicação ao nosso código |
|---|---|---|
| Fila nativa de entrada no celular | `WatchBridgePlugin.swift:265–280` grava eventos antes de notificar a interface; `drainWatchEvents` aplica, salva e confirma | Adaptar uma inbox durável Android. Hoje `WearBridgeService` entrega ao WebView e devolve indisponibilidade quando a ponte não está acessível; o relógio mantém a cópia. A inbox permitiria receber e tentar novamente durante a inicialização ou retomada do app. |
| Eventos atrasados no histórico | `watch-sync.js:257–272` e `patchSetIn:600–646` localizam o treino já salvo e atualizam a série | Principal lacuna para treino finalizado no celular enquanto havia trabalho offline. Requer preservar, antes do envio ao relógio, um manifesto privado que relacione sessão autorizada, treino e alvos do mesmo dono. O pacote atual não contém um ID de treino suficiente para fazer esse roteamento. |
| Conciliação por série | `WatchCore/SessionCore.swift:99–129` mantém ticks locais até confirmação por série; a ponte compara timestamps nas séries já salvas | Adaptar um merge de três vias por alvo/campo. Hoje a impressão do treino inteiro muda com a edição de outra série e bloqueia o lote. Introduzir identidade estável para entrada/série; uma edição sem relação não deveria invalidar toda a importação. |
| Batimentos tardios independentes dos valores da série | `watch-sync.js:296–305, 632–640` recebe `setHr` depois e mantém batimentos mesmo quando uma edição mais recente conserva os números do celular | Nosso `wear-heart-session.js` já recebe medições tardias no histórico **quando a associação foi criada antes**. Falta cobrir a associação de séries cuja primeira importação só chega após o fim do treino. Preservar curva, esforço e recuperação no formato existente. |
| Retomada e reinstalação | `startWatchSync` revê o vínculo na retomada e invalida a deduplicação do snapshot quando o relógio volta disponível | Adaptar os casos de teste de vínculo tardio e reinstalação ao transporte Wear, mantendo confirmação explícita de aplicação. |
| Leitura pelo Health Connect | `health-sync.js`, `health-read.js`, `HealthRead.java` leem amostras do hub e preenchem medições ausentes | Possível recuperação adicional, com permissão e dados efetivamente disponíveis no hub. A atribuição por série pode ser estimada; deve ter origem e precisão distinguíveis da captura direta do nosso relógio. |

## Limitações reproduzidas na nossa branch

Três testes sintéticos de diagnóstico exercitaram o helper real, sem dados pessoais ou aparelhos:

1. Editar a segunda série no celular antes da primeira importação offline bloqueia a conclusão da primeira com `baseline-conflict`.
2. Mover o treino para o histórico antes de importar bloqueia o lote com `stale-context`.
3. Depois de importar um lote, editar outra série no celular bloqueia um lote seguinte com `state-conflict`.

Nos três casos, a função preserva o estado recebido. Isso confirma limitações do contrato atual; **não identifica ainda qual cenário causou o novo relato do usuário**. Os testes existentes já exigem parte desses bloqueios como proteção contra alterações concorrentes. A melhoria precisa substituir essa proteção por uma conciliação mais granular, sem simplesmente remover as verificações.

## O que não copiar diretamente

- **A main inteira:** reintroduziria arquitetura de servidor/passkeys/Coach que nossa adaptação retirou, além de outras mudanças de plataforma, dependências e identidade do app. Não é uma atualização isolada de sincronização Wear.
- **`heart-rate.js`:** a original usa campos `hr` e `restHr`, principalmente resumos; nossa versão usa `heartRate` com pontos do gráfico, fases, limites e marcos. Substituir o arquivo quebraria o contrato atual.
- **Descarte de fila excedente:** o Swift usa `suffix(500)` nas filas e escrita com `try?`. Para nosso requisito, fila cheia/falha de gravação deve ser visível e manter registros não confirmados.
- **Confirmação de evento desconhecido:** `applyEvents` considera alguns eventos sem treino/alvo como concluídos e os confirma. Precisamos manter eventos sem destino seguro para diagnóstico/recuperação, sem ACK destrutivo.
- **Deduplicação fora da transação:** a lista de IDs da original fica no `localStorage` e é atualizada antes de `saveNow`. Nossa adaptação deve guardar aplicação e recibo na mesma confirmação durável do armazenamento do dono.
- **Escolha do alvo pelo primeiro exercício de mesmo ID:** o fallback da original não oferece identidade inequívoca quando há exercícios repetidos/reordenação. Usar alvo persistente, sessão e dono; ID importável do treino não substitui autorização.
- **Reenvio com limite de tentativas:** a transferência do Apple Watch tenta novamente algumas vezes. Nosso transporte precisa conservar o evento até confirmação durável ou decisão explícita do usuário.

## Recomendação de incorporação

Adaptar os mecanismos para Java/Wear Data Layer e o armazenamento Firebase/offline existente, preservando o aplicativo Wear e o layout atual. Prioridade: manifesto privado e identificação estável dos alvos; importação em treino ativo ou histórico com recibo atômico; conciliação por série; inbox nativa e retomada automática. Health Connect é uma etapa adicional de recuperação.

Manter compatibilidade com filas v1 já existentes durante qualquer migração. Falhas reais de identidade, remoção de série ou escrita continuam preservando a fila. Não substituir curvas cardíacas por médias nem retargetear séries por posição aproximada.

Casos obrigatórios antes de instalar: finalização offline seguida de fim do treino no celular; alteração de outra série; mudança do mesmo campo nos dois dispositivos; inserção/remoção/reordenação e exercício repetido; morte do processo antes/depois de salvar/confirmar; pacote duplicado; perfil diferente; batimentos chegando antes e depois da conclusão; falha de disco e fila cheia. Verificar os dados persistidos nos dois aparelhos, não apenas a mensagem de sucesso.

## Commits úteis como referência

- [`ebca1d176`](https://github.com/DuarteSantos8/openGym/commit/ebca1d176): núcleo testável do Apple Watch e conciliação de snapshots/eventos.
- [`d92ce2292`](https://github.com/DuarteSantos8/openGym/commit/d92ce2292): entrada nativa gravada antes da notificação e confirmação após salvar.
- [`f95b2f259`](https://github.com/DuarteSantos8/openGym/commit/f95b2f259): restauração e prevenção de duplicação na retomada.
- [`d19ef668e`](https://github.com/DuarteSantos8/openGym/commit/d19ef668e): vínculo tardio, reinstalação e reenvio de snapshot.
- [`f9c03474f`](https://github.com/DuarteSantos8/openGym/commit/f9c03474f): leitura de batimentos pelo Health Connect/Apple Health.

São referências para portabilidade e testes, não uma lista de cherry-picks compatíveis sem adaptação.
