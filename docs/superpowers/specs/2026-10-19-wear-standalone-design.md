# Treino independente no relógio

## Objetivo e autorização

Com a tela do telefone apagada, tocar em Iniciar no relógio hoje não inicia a série. O usuário quer iniciar/pausar o exercício, salvar a série e iniciar o descanso no relógio, continuando sem resposta do telefone; ao abrir o app no telefone, sincronizar. Pediu plano e implementação direta, sem novas perguntas, e abrir o editor de layout ao final.

O treino deve ter sido enviado ao relógio uma vez. Criar rotinas e escolher um treino totalmente novo continua no telefone. Preservar os tipos de série já suportados pelo relógio (repetições simples, incluindo lados e supersets); tipos complexos continuam explicitamente indisponíveis, nunca concluídos ou pulados silenciosamente.

## Abordagem

Um serviço de foreground no telefone pode ajudar a entrega, mas não garante execução da WebView com a tela apagada. A correção é executar as ações localmente no relógio. O telefone envia a sequência de séries e descansos calculada pelas regras existentes. O relógio grava estado e eventos juntos antes de confirmar cada ação. O telefone recebe os eventos em ordem, valida o treino e os valores de origem, grava as mudanças e só então confirma recebimento.

Não criar outro backend ou dependência. Usar Java 21/SDK 35, SharedPreferences com commit atômico no relógio e o armazenamento local existente no telefone. Sem identificadores de conta nos pacotes.

## Contrato v1 adicional

- `contextToken` do treino ativo passa a usar o `activeSessionToken` opaco e persistente local, válido apenas para esse perfil/sessão. Não usar o ID importável do treino como autorização.
- Estado: `standalone = {v:1, sessionId, baseline, steps, cursor, ack, runtime}`. `baseline` é a impressão determinística do treino relevante (unidade, estrutura, prescrições, valores/done das séries e estado normalizado do descanso; excluir medições cardíacas e bookkeeping da sincronização). `publisherId` distingue reinícios do publicador; `localReady=false` identifica a hidratação inicial e não encerra o treino local.
- Cada elemento de `steps` contém os campos já usados por `current`, `restAfterSec`, `warmup` e `manualLoad`. `cursor` indexa a sequência original. A ordem e os descansos respeitam lados, supersets, aquecimento e descanso desligado. Máximo 200 passos; acima do limite informar indisponibilidade, sem truncar silenciosamente.
- `ack = {streamId, seq}` ou null. `runtime = {effort, timer}`; `effort = {startedAt, elapsedMs, paused, resumedAt, token, heart}` ou null. `timer` mantém o formato existente (`timerToken`, `endsAt`, `leftMs`, `paused`, `ready`).
- Evento: `{seq, id, action, at, step, field?, value?, unit?, heart?}`. `seq` começa em 1; `id` é UUID estável; `step` indexa a sequência original. Ações: `start`, `pause-effort`, `resume-effort`, `complete`, `edit-set`, `pause`, `resume`, `plus15`, `skip`, `cancel-effort`.
- Comando: `{v:1, action:'standalone-sync', requestId, contextToken, streamId, baseline, events}`. Enviar até 64 eventos por pacote, em ordem, com requestId igual ao ID do último evento. Limites: 1024 eventos por sessão, 128 KiB por snapshot e 64 KiB por comando; validar antes de aceitar.
- Resposta: `{v:1, requestId, status, code?, streamId, seq}`. Confirmar apenas a sequência persistida. Reenvios idênticos não reaplicam séries; reutilização de ID/seq com conteúdo diferente é conflito.

## Persistência e conflitos

No telefone, `S.active._wearStandalone` mantém o checkpoint privado: stream, eventos aceitos, passos originais, cursor, runtime e impressão do último estado aplicado. O codec já preserva `active` localmente; o fechamento do treino usa whitelist e não exporta esse checkpoint. A primeira importação exige baseline igual; as próximas exigem que o telefone não tenha alterado o estado relevante desde a última importação. Aplicar um lote numa cópia, validar tudo e persistir uma única atualização. Falha de disco impede confirmação; repetir tenta a gravação pendente, sem duplicar mutações.

O estado privado `_wearStandaloneTimer` mantém a origem persistida do descanso. Alterações explícitas no telefone são persistidas antes da publicação e entram no baseline; o decremento normal do relógio não muda o baseline. Sem eventos pendentes, o relógio aceita a nova origem; havendo alterações concorrentes, preserva seu registro como conflito. A importação mantém o prazo absoluto, restaura pausas e não anuncia descansos já vencidos. O limite de 900 segundos vale nos dois dispositivos, inclusive para +15.

No relógio, um documento guarda snapshot-base, stream, cursor, eventos, sequência confirmada, runtime e conflito. Não sobrescrever trabalho pendente com snapshot atrasado, treino substituído ou troca de conta. Conflitos preservam dados para revisão e não enviam ações para outro treino. Descarte só por ação explícita na interface. O estado local e a fila sobrevivem à recriação do processo. Descanso usa prazo absoluto e o alarme local existente.

## Interface e sensor

Iniciar funciona sem conexão e sem exigir leitura cardíaca. Durante a série, salvar conclui e inicia o descanso local; pausar/retomar a série fica acessível nas opções. Descanso permite pausar/retomar, +15 e pular localmente. Exibir pendências de sincronização e conflitos. Manter consentimento do sensor; se habilitado, registrar a captura local com o token do evento de início e associá-la ao alvo validado durante a sincronização. Não exigir o sensor para treinar.

## Verificação

Testes de sequência/resto, valores decimais, lados/supersets, reinício, reenvio/ACK perdido, eventos inválidos, falha de disco, alteração concorrente e troca de perfil. Teste nativo de UI sem telefone para iniciar, completar, descansar, pausar e continuar outra série; regressões existentes e builds. A instalação física depende de dispositivo conectado e deve ser relatada separadamente.
