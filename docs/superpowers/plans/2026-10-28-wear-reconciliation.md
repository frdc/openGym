# Wear reconciliation implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Execução direta autorizada pelo usuário; continuar na branch `codex/wear-standalone` e preservar aprovações anteriores de commit/push.

**Goal:** Importar trabalho e batimentos offline apesar de edições independentes ou fechamento do treino, com uma inbox durável no celular.

**Architecture:** Manifestos e recibos privados no envelope do dono, replay isolado seguido de merge por campo e alvos estáveis. A ponte nativa guarda entradas até confirmação e o relógio negocia autorização de replay/recibos sem substituir pendências.

**Tech Stack:** React/JS, Zustand, Capacitor 7.6.9, Java 21/SDK 35; nenhuma dependência nova.

**Spec:** `../specs/2026-10-28-wear-reconciliation-design.md`.

## Global Constraints
- Preservar filas v1, curvas cardíacas e isolamento de dono/sessão; nenhuma limpeza de dados.
- Estado e recibo de aplicação na mesma confirmação durável; erro não confirma ao relógio.
- Não importar Swift, servidor original ou metadados privados para exportações/Firestore.
- Manter layout atual e verificar somente aparelhos identificados; excluir `0123456789ABCDEF`.

## Review Focus
- Comando chega antes do manifesto ou batimentos antes do diário: aguardar, não descartar.
- Usuário copia ou remove alvos/reordena exercícios repetidos: nunca aplicar por proximidade de índice.
- Falha entre gravar treino, adotar batimentos, remover inbox e enviar ACK: reenvio sem perda/duplicação.
- Finalizar A, iniciar B e receber dados de A: importar em A, manter B e seus temporizadores.
- Troca de conta ou unidade, fila cheia e metadados exportados: bloquear de forma conservadora e manter evidências.

## Tasks

### Task 1: Identidade e metadados atômicos
**Files:** `wear-ledger.js/.test.js` (novo), store/useStore.js, cloud/sync-bridge.js, cloud/codec.js e testes, finish-workout.js e testes.
**Interfaces:** `identifyWearTargets(S) -> S`; store publica `wearSessions`, `update(...,{wearSessionUpdates})`; codec mescla metadados do mesmo dono no draft.
- [x] Escrever testes de identidade única/duplicada e preservação ao fechar; metadados duráveis fora de exportações e atualização atômica; observar RED.
- [x] Implementar as interfaces e rodar testes focados (GREEN); commit.

### Task 2: Replay e merge por série/histórico
**Files:** `wear-ledger.js/.test.js`; wear-standalone.js; history/sync-merge helpers existentes.
**Interfaces:** `prepareWearLedger(S,sessionId,sessions) -> {S,updates,projection}`; `applyWearLedger(S,sessions,command,currentSessionId,nodeId) -> {S,updates,checkpoint,workoutId,activeRuntime}`; `wearSyncProjection(sessions)`.
- [x] Testes RED para três cenários reproduzidos, alvos removidos/ambíguos, mesmo campo, duplicatas, outro dono/sessão/unidade, A fechado/B ativo e curvas existentes.
- [x] Implementar replay isolado e merge, limites e recibos; testes GREEN; commit.

### Task 3: Ponte e associação cardíaca
**Files:** wear-bridge.js/.test.js; wear-heart-session.js/.test.js; wear-standalone.integration.test.js.
**Interfaces:** preparação antes de publicar; importação com `wearSessionUpdates`; `heart.adoptCheckpoint(checkpoint,workoutId)` antes do ACK; publicação `standaloneSync`.
- [x] RED integrado com store real: finalizar A sem importar, iniciar B, receber ações e batimentos de A; falha de flush não publica recibo.
- [x] Implementar preparação serializada e importação; preservar fallback legado para mocks/filas sem manifesto; GREEN; commit.

### Task 4: Inbox durável Android
**Files:** `WearInbox.java`, unit tests (novos), WearBridgeService.java, WearBridgePlugin.java, `wear-inbox.js/.test.js` (novo), wear-bridge.js.
**Interfaces:** native `drainInbox/ackInbox`; eventos transportam `inboxKey`; JS `createWearInbox` coordena chamadas e remoção exata somente após sucesso.
- [x] RED: reinício, duplicata, payload diferente com mesmo requestId, falha de disco, limite, batimentos antes do diário, troca de conta.
- [x] Implementar AtomicFile/injeção Store, conexão com serviço/plugin e dreno na retomada; GREEN; commit.

### Task 5: Relógio e negociação de replay
**Files:** WearStandalone.java/Test, WearStateService.java, WearRefresh.java/Test.
**Interfaces:** autorização exata por sessão/base em `standaloneSync`; recibos históricos; replay de A enquanto B está no celular sem apagar A; handshake manual preserva correlação.
- [x] RED nativo: nova base após edição independente, A fechado/B ativo, recibo perdido, manifesto diferente/ausente e falhas de gravação.
- [x] Implementar preservação/reenvio autorizado e novos conflitos permanentes por campo/alvo; GREEN; commit.

### Task 6: Validação e entrega
- [x] Rodar suíte web, unitários Android, build mobile/APKs e cenários nativos em emulador/aparelhos acessíveis.
- [x] Revisão independente do conjunto; corrigir achados importantes com RED→GREEN e repetir verificações afetadas.
- [x] Atualizar contrato/diário, commit/push autorizados, informar resultado físico separadamente de compilação.
