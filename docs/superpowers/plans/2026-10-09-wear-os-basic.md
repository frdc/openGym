# Wear OS básico — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Controlar a série atual e o descanso do OpenGym pelo Galaxy Watch Ultra, com confirmação pelo celular.

**Architecture:** Módulo Wear OS nativo acompanhante e plugin Capacitor comunicam estado e comandos via Data Layer. O treino e o armazenamento continuam no celular. O relógio agenda o alerta do timer recebido.

**Tech Stack:** React 19, JavaScript, Zustand, Capacitor 7.6.9, Java 21, Android SDK 35, Android Views e Google Play Services Wearable (versão exata oficial verificada na implementação).

**Spec:** `docs/superpowers/specs/2026-10-09-wear-os-basic-design.md`

## Global Constraints

- Sem batimentos, edição de reps/carga no relógio, Firebase de produção ou publicação.
- Reusar regras existentes de séries, supersets, lados, descanso e unidades.
- Preservar contexto de proprietário/sessão e tokens opacos; não transportar UID ou credenciais.
- Debug de celular e relógio com applicationId `ch.duartesantos.opengym.test` e mesma assinatura.
- Novas strings passam pelos mecanismos de localização; alterações pré-existentes do usuário permanecem intactas.
- Conclusão depende de confirmação; não há fila de conclusões offline.

## Review Focus

1. Duplo toque e repetição de mensagem: uma única conclusão, sem avançar a série seguinte.
2. Troca de conta/sessão enquanto há comando pendente: rejeitar comando antigo e limpar projeção.
3. Supersets, lados e séries temporizadas: preservar regras ou pedir uso do celular.
4. Suspensão/encerramento da WebView: nunca confirmar uma alteração que não foi persistida.
5. Desconexão durante cancelamento de timer: indicar estado desatualizado e evitar promessa de cancelamento remoto.

## Task 1: Projeção e contrato de comandos

**Files:** criar `frontend/src/lib/wear-protocol.js` e `wear-protocol.test.js`.

**Interfaces:** `projectWearState({ S, timer, contextToken, revision, ready, now })` retorna objeto JSON v1 com `contextToken`, `revision`, `active`, `current` e `timer`; `current` contém `entryIdx`, `setIdx`, `side`, `name`, `setLabel`, `repsLabel`, `loadLabel`, `canComplete`. Timer usa `timerToken`, `endsAt`, `leftMs`, `paused`, `ready`. `validateWearCommand(command, snapshot)` retorna `null` ou código de erro. Comando contém `v`, `requestId`, `contextToken`, `revision`, `action`, `target`; ações `complete`, `pause`, `resume`, `plus15`, `skip`. Alvo de conclusão contém índices e lado; alvo de timer contém token.

- [ ] Escrever testes: projeção sem treino fica inativa; unidades seguem configuração; contexto inválido bloqueia controle; revisão/alvo/token antigos são rejeitados; tipos desconhecidos e payloads malformados são rejeitados. Cobrir série comum, unilateral, superset e tipo especial sem suporte.
- [ ] Rodar `npx vitest run src/lib/wear-protocol.test.js` em `frontend`; confirmar falha antes da implementação.
- [ ] Implementar projeção reusando helpers de seleção, nomes e unidades existentes; não copiar lógica de progressão.
- [ ] Rodar o teste e confirmar aprovação.

## Task 2: Controlador do celular e persistência

**Files:** criar `frontend/src/lib/wear-session.js`, `wear-session.test.js`, `frontend/src/lib/wear-bridge.js`; modificar `frontend/src/views/Workout.jsx` e `frontend/src/App.jsx`.

**Interfaces:** `createWearController({ readSnapshot, completeCurrent, timerAction, flushLocal, publish, reply })` expõe `handle(command)` e `dispose()`. `bindWearBridge(controller)` retorna cleanup. `completeCurrent(target)` chama o mesmo caminho de conclusão usado pela tela Workout; `timerAction(action)` usa useUI. Resposta `{ v:1, requestId, status, code, revision }`, com status `ok` ou `error`.

- [ ] Testar duplo envio com mesmo requestId: completeCurrent chamado uma vez; revisão antiga após conclusão rejeitada; falha de flushLocal nunca retorna ok; contexto alterado durante flush rejeita confirmação; controlador indisponível retorna erro. Timer não conclui série.
- [ ] Rodar `npx vitest run src/lib/wear-session.test.js`; confirmar falha.
- [ ] Implementar serialização e deduplicação limitada ao contexto atual. Gerar contexto opaco novo quando proprietário/sessão mudar; publicar somente estado pronto. Registrar o handler de conclusão junto ao `toggle` existente em Workout.jsx e remover no cleanup; fora da tela pronta, informar indisponibilidade. Não extrair toda a lógica do treino nesta etapa.
- [ ] Conectar ponte somente em Android, com listener e publicação por assinatura de Zustand. A revisão muda em alterações relevantes, não em ticks visuais. Confirmar sucesso apenas após flushLocal e revalidação de contexto.
- [ ] Rodar testes do controlador e regressões de Workout/useUI afetadas.

## Task 3: Transporte Android

**Files:** criar `frontend/android/app/src/main/java/ch/duartesantos/opengym/WearBridgePlugin.java` e `WearBridgeService.java`; modificar `MainActivity.java`, `app/src/main/AndroidManifest.xml` e `app/build.gradle`.

**Interfaces:** plugin Capacitor `WearBridge` com `publish({state})`, `reply({nodeId,response})`, `status()` e evento `command` com `{nodeId,command}`. Paths v1: `/opengym/v1/state`, `/opengym/v1/command`, `/opengym/v1/reply`. Capabilities `opengym_phone_v1` e `opengym_watch_v1`.

- [ ] Adicionar testes JVM de validação de path/tamanho/versão e rejeição de remetente sem capability compatível; resposta indisponível quando bridge não estiver pronta. Confirmar falha antes da implementação.
- [ ] Implementar DataClient para snapshot, MessageClient para comandos/respostas, WearableListenerService para recepção e plugin registrado em MainActivity. Fixar dependência oficial sem atualizar dependências não relacionadas.
- [ ] Usar mensagens limitadas a 16 KiB, sem logs de dados privados; limpar readiness no encerramento da ponte. Não guardar comandos para execução posterior.
- [ ] Rodar `gradlew.bat --no-daemon :app:testDebugUnitTest :app:assembleDebug` em `frontend/android`.

## Task 4: App Wear OS e alertas

**Files:** criar módulo `frontend/android/wear` com `build.gradle`, `src/main/AndroidManifest.xml`, recursos e classes em `src/main/java/ch/duartesantos/opengym/`: `WearActivity.java`, `WearStateService.java`, `WearTimer.java`, `WearTimerReceiver.java`, `WearProtocol.java`. Modificar `frontend/android/settings.gradle`. Criar testes em `wear/src/test/java/ch/duartesantos/opengym/`.

**Interfaces:** WearProtocol decodifica snapshot/respostas do Task 1/2; WearTimer aplica estado `{timerToken,endsAt,leftMs,paused,ready}` e cancela por token. WearStateService mantém último snapshot como cache, sem autoridade de treino; Activity envia comandos e aguarda resposta.

- [ ] Testar substituição/cancelamento de timer, pausa/retomada, alerta único, contexto novo limpando estado, timeout de resposta, snapshot antigo e payload malformado. Rodar `:wear:testDebugUnitTest` e confirmar falha.
- [ ] Criar tela circular com textos e botões grandes, estado sem treino, aguardando confirmação e desconectado. Timeout de comando de 8 segundos, sem reenvio automático; antes de nova tentativa solicitar snapshot atual. Ping/estado atual ao abrir e ao reconectar; cache não habilita conclusão.
- [ ] Implementar contagem local e alerta Android apropriado a timer com receiver/token persistido. Tratar permissão/limitação do sistema explicitamente na UI; nunca informar alarme habilitado sem conseguir agendá-lo. Aplicar configuração de vibração do celular.
- [ ] Suprimir espelhamento duplicado do alerta do celular apenas quando o acompanhante estiver ativo, usando recursos oficiais de notificações Wear OS; preservar comportamento de quem não usa relógio.
- [ ] Rodar `gradlew.bat --no-daemon :wear:testDebugUnitTest :wear:assembleDebug :app:assembleDebug`.

## Task 5: Validação e entrega local

**Files:** criar `docs/dev/WEAR_OS_VERIFICATION.md`; atualizar `docs/MOBILE.md`. Acrescentar testes de integração do protocolo/ponte no frontend quando necessário.

- [ ] Testar integração: conclusão -> persistência -> snapshot seguinte -> descanso, incluindo rejeição de comando antigo e cleanup por conta/sessão. Confirmar teste falhando e depois passando com a integração completa.
- [ ] Executar `npm test`, `npm run test:build-scripts`, `node scripts/check-locales.mjs`, `npm run build`, `npm run check:cloud-bundle`, `npm run build:mobile`; recompilar ambos os APKs e rodar testes JVM após sync.
- [ ] Documentar caminhos dos dois APKs debug, mesma assinatura e instruções ADB para instalação. Não instalar em aparelhos não identificados nem substituir variantes release.
- [ ] Se Galaxy Watch Ultra e celular estiverem acessíveis, executar checklist físico da spec: série, descanso, tela apagada, desconexão, alteração de sessão, celular bloqueado e processo encerrado. Se indisponíveis, registrar teste físico pendente e entregar os APKs com instruções.
- [ ] Registrar comandos/resultados e limitações sem incluir identidades, credenciais ou logs privados. Revisar diff e separar alterações pré-existentes. Só afirmar funcionamento no relógio com evidência física.

## Método de execução proposto

**Estado em 2026-10-09:** tarefas 1–5 implementadas e verificadas localmente; APKs debug do celular e relógio gerados. Revisão independente concluída e ajustes incorporados. Teste físico pendente por ausência de aparelhos conectados. Evidência e instalação em `docs/dev/WEAR_OS_VERIFICATION.md`.

Execução direta nesta conversa, por tarefas sequenciais, porque protocolo, controlador e app Wear compartilham interfaces e precisam evoluir juntos. Revisão do conjunto ao final. A escolha do método e a revisão deste plano precedem o código conforme o fluxo de brainstorming.
