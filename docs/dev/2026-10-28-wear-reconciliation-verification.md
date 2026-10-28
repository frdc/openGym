# Reconciliação Wear: contrato e verificação

Aproveitamento da [análise da main original](2026-10-28-upstream-watch-sync-review.md), implementado em Java/React na branch `codex/wear-standalone`. Não houve merge do servidor original ou do código Swift. [Plano](../superpowers/plans/2026-10-28-wear-reconciliation.md) e [contrato](../superpowers/specs/2026-10-28-wear-reconciliation-design.md).

## Comportamento

- Identidades `logId` acompanham entradas e séries. O diário antigo é reexecutado na cópia preparada e somente os campos alterados são conciliados com o treino ativo ou histórico. Edição independente no celular permanece; valores incompatíveis no mesmo campo, alvo removido/ambíguo ou unidade diferente mantêm a pendência sem sucesso ao relógio.
- Séries atrasadas de A entram em A por ID e início, mesmo que B já esteja aberto. A importação histórica não reabre A nem altera B ou seus alarmes. Entradas preparadas permanecem no histórico mesmo se o celular ainda não marcou suas séries.
- Manifestos, checkpoints e recibos ficam no envelope local do dono, fora de `S`, exportações compartilháveis e Firestore. Estado e recibo de aplicação são confirmados juntos. O relógio só troca de base depois de reconhecer confirmação correspondente ao stream/evento.
- A projeção `standaloneSync` v2 anuncia as últimas 96 bases e a base exata pedida por `replay = {sessionId,baseline}`. Os manifestos anteriores continuam gravados. Uma pendência antiga pode exigir uma consulta adicional para autorização; o limite total permanece 1024 bases/16 MiB por dono.
- A inbox nativa grava diário e medições antes de notificar o WebView; drena no início, na retomada, na disponibilidade da conta e ao receber dados. Limites: 512 itens/8 MiB, sem corte silencioso. Nó/tipo/conteúdo completo definem a chave; mesmo requestId com outro conteúdo permanece separado. Falha de gravação/remoção não gera ACK de sucesso. Arquivo e estágios AtomicFile ficam fora de backup e transferência Android.
- Vínculos cardíacos guardam treino/início, nó, sessão e identidade da entrada/série/lado. Migração de um vínculo antigo exige correspondência única; cópia ambígua não recebe uma curva por proximidade ou timestamp isolado. Curvas já finalizadas não são estendidas pelo replay do diário.
- Descanso e posição usam a última identidade e timer importados, inclusive entre lotes de supersets e reordenações. Alterações independentes no celular não se tornam, no lote seguinte, autorização para substituir seu timer.

## Evidências

- Regressões integradas com store real: A encerrado sem marcações, B ativo, diário e curva tardios; edição independente, replay duplicado, falha de confirmação local/nativa e remount; inbox recebe batimentos antes do diário e conserva item de outra sessão.
- Revisão independente encontrou associação cardíaca por timestamp após cópia e comparação de posição com a base inicial do superset. Os dois cenários falharam antes das correções e passaram depois, incluindo cópia substituta ao vivo, reordenação e preservação de timer alterado no celular. Nenhum achado menor foi deixado para depois.
- JVM: **9 testes do celular + 64 Wear**, aprovados. Incluem falha de disco, corrupção, limites da inbox, snapshot diferente com mesmo requestId, autorização exata, recibo perdido e falha de gravação do recibo no relógio.
- Emulador Wear: **10 instrumentados**, aprovados — persistência real SharedPreferences, reabertura, fluxo offline e outbox cardíaca. Emulador celular: **3 instrumentados**, aprovados — reabertura AtomicFile e retirada exata, request com tela apagada e serviço de treino. A primeira execução do teste de notificação falhou porque POST_NOTIFICATIONS estava negada; após concedê-la somente no emulador, os três passaram.
- Scripts de build: **6 testes**; traduções: **17 idiomas/2.037 chaves**. Builds web/mobile e verificação de bundle aprovados, com avisos preexistentes de React/importação dinâmica/tamanho de chunks. Cópia Android idêntica ao bundle mobile.
- Suíte web final após o passe de correção: **361 arquivos/3.942 testes**, aprovada. Bundle mobile e ambos os APKs finais compilados. Os três instrumentados do celular passaram novamente sobre seu APK final; o fonte Wear permaneceu igual ao dos dez instrumentados aprovados.

## Limites da evidência

Nenhum celular ou relógio físico apareceu no ADB/mDNS nesta execução. Os APKs foram instalados somente nos emuladores; sincronização pelo Data Layer entre aparelhos reais e coleta cardíaca real ainda precisam de validação física. Não foram limpos dados dos aparelhos nem reiniciado o servidor do visualizador de movimento. As pendências antigas não foram descartadas.

Ao testar: preparar treino A e ativar batimentos; fechar o app do celular; concluir séries no relógio; no celular editar outra série ou encerrar A/iniciar B; reabrir e usar **Sincronizar com o relógio**. Conferir conclusão/curva em A, B preservado e filas do relógio esvaziadas somente após confirmação. Sem vínculo de teste físico, os resultados automatizados não comprovam o comportamento da conexão Bluetooth/Wi-Fi dos aparelhos do usuário.
