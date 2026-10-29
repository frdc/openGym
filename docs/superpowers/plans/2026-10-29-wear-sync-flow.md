# Wear Sync Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Execução direta autorizada; reutilizar `codex/wear-standalone`.

**Goal:** Eliminar trabalho repetido na ponte Android/Wear e tornar a reconexão diagnosticável.
**Architecture:** Publicação agrupada, observação seletiva e conciliação idempotente; pull limitado no relógio e diagnósticos locais. Persistência/ACKs existentes são mantidos.
**Tech Stack:** React/JS, Capacitor 7.6.9, Java21/SDK35; nenhuma dependência nova.
**Spec:** `../specs/2026-10-29-wear-sync-flow-design.md`.

## Global Constraints
- Preservar dados, filas v1/v2, dono e ACK durável. Não limpar aparelhos.
- Manter layout de treino/descanso e não registrar payload/identidade/batimentos.
- Excluir dispositivo `0123456789ABCDEF`; não reabrir servidor de movimento.

## Review Focus
- Mudança de dono durante publicação/adopção ou callback fora de época nunca confirma dado de outro dono.
- Publicação bloqueada/falha e pulls concorrentes não criam fila ilimitada nem perdem o handshake manual.
- UI parada não faz I/O; retomada/entrada nativa ainda reprocessa trabalho retido.
- Limites cardíacos confirmados não regridem nem reabrem uma captura; falha de disco ainda retém ACK.
- Diagnóstico ausente/falho não bloqueia treino, faz I/O por tick ou expõe dados privados.

### Task 1: Conciliação cardíaca idempotente
**Files:** wear-heart-session.js/.test.js.
**Interfaces:** reconcile coalescido; adoção preserva limites já gravados e cache por dono/manifesto/checkpoint com on-demand independente.
- [ ] RED observado: três conciliações regravam três vezes; adicionar concorrência e mudança durante await.
- [ ] Implementar preservação/cache e GREEN com curvas, cópias, disco e histórico; commit.

### Task 2: Ponte Android com trabalho agrupado
**Files:** wear-publisher.js/.test.js (novo), wear-bridge.js/.test.js, wear-standalone.integration.test.js, WearBridgePlugin.java.
**Interfaces:** createWearPublisher({send,dropped}).publish(request,key), dispose; subscriptions seletivas; releaseRequest nativo para pull substituído.
- [ ] RED observado: dreno a cada evento UI e 30 publicações antes da abertura; cobrir prioridade/correlação, falha, dispose, retomada e dono.
- [ ] Implementar ator de snapshots e gatilhos seletivos, sem alterar replay/ACK; GREEN; commit.

### Task 3: Reconexão e debug no relógio
**Files:** WearSyncPull.java/Test, WearSyncDiagnostics.java/Test (novos), WearActivity.java, WearStateService.java, WearRemoteOpen.java, WearBridgeService/Plugin.java, strings nativas e teste instrumentado.
**Interfaces:** pull.request(id,now)/matches/finish/reset; trace/event/snapshot sem payload; Opções → diagnóstico debug.
- [ ] RED: pedidos simultâneos, timeout/callback antigo e snapshot recebido sem pull recursivo; UI de diagnóstico e privacidade.
- [ ] Implementar gate e atualizar receiver para render/replay; contadores/logs nas fronteiras e UI; GREEN; commit.

### Task 4: Medição, revisão e entrega
- [ ] Suíte web, scripts/locales, JVM, mobile/APKs e emuladores; aparelho quando acessível, sem simular treino pessoal.
- [ ] Uma revisão independente final; achados importantes reproduzidos e corrigidos; repetir verificações afetadas.
- [ ] Diário/evidências, commit/push e limpeza de scratch próprio; informar limite da medição física.
