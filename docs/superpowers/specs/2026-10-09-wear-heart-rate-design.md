# Batimentos por série no Galaxy Watch Ultra

## Intenção e fluxo escolhidos

Registrar frequência cardíaca como referência para comparar esforço e recuperação durante o treino. Não usar batimentos para decidir descanso, carga, progressão ou conclusão. O usuário escolheu **Iniciar série** no relógio e depois **Concluir série**. Em seguida pediu incluir o descanso para observar quanto tempo leva para começar a se recuperar. Conservar a distinção entre as fases no mesmo registro e gráfico.

Esta etapa acrescenta um subsistema de coleta de saúde e dados persistidos por série à integração Wear OS existente. O botão Abrir no relógio, os timers, a gravação local e os controles atuais permanecem como base.

## Experiência

No relógio, oferecer ativação opcional de batimentos durante o treino e pedir a permissão apropriada. Mostrar frequência atual quando houver leitura válida; enquanto o sensor ainda estiver adquirindo sinal, mostrar indicação de leitura pendente. Treinar sem conceder permissão continua possível.

Para uma série comum, **Iniciar série** marca o início e passa a mostrar **Concluir série**. A confirmação do celular vincula a marcação ao alvo atual. Ao concluir, seguir o fluxo existente de gravação e descanso, continuando a coleta para a fase de recuperação daquela série. O próximo toque em **Iniciar série** encerra a recuperação anterior e inicia o esforço seguinte. Ajuste aprovado pelo usuário em 09/10/2026: após confirmar esse novo início de forma durável, cancelar o timer de descanso anterior da mesma sessão, inclusive pausado ou em Pronto. Uma falha de confirmação conserva o timer; repetir uma mensagem de início ou concluir pelo celular durante a gravação não pode apagar um novo descanso. O fim do timer de descanso não encerra a coleta: o usuário pode demorar mais para começar. Encerrar o treino ou desativar a coleta também fecha a recuperação, identificando esse motivo.

Permitir cancelar a marcação sem concluir a série. Impedir duas séries em coleta ao mesmo tempo. Navegar para outro exercício não transfere a coleta silenciosamente: cancelar ou concluir a série marcada primeiro. Se a série for removida, a sessão trocada ou a conta alterada, invalidar a marcação e não associar seus dados a outra série.

A primeira entrega cobre séries de repetições já concluíveis pelo relógio, incluindo lados e supersets nas regras existentes. Séries temporizadas/cardio/dropsets/rest-pause continuam pedindo uso do celular; a coleta geral pode continuar, mas não inventar intervalos por série para esses tipos.

## Histórico

Mostrar junto à série um gráfico único em bpm, com marcação visível de **fim da série** e fases identificadas como esforço e recuperação. Média e pico do esforço ficam separados dos dados do descanso; não apresentar a média combinada como média da execução. Os detalhes indicam duração de cada fase e se faltaram leituras. Sem leituras válidas, mostrar **Sem leituras**, não 0 bpm. Dados incompletos ficam identificados como parciais.

Mostrar, quando houver leituras suficientes, frequência ao terminar e após 30, 60 e 120 segundos de recuperação, acompanhadas da diferença em bpm. Escolher a leitura válida mais próxima de cada marco dentro de cinco segundos e exibir o tempo efetivamente medido; fora dessa janela, omitir o valor. Não interpolar, não inventar marcos após o começo da próxima série e não classificar recuperação como boa/ruim. O gráfico permite observar a queda sem impor um limiar arbitrário para dizer que a recuperação começou.

Quando o treino ainda estiver ativo, permitir ver o resumo das séries concluídas. Depois de terminar, conservar os resumos e pontos no histórico. Desmarcar/repetir uma série não reaproveita automaticamente a medição anterior; uma nova marcação substitui os dados daquela série apenas após uma nova conclusão confirmada.

## Coleta no relógio

Usar Android Health Services ExerciseClient, adequado a coleta durante um treino, com serviço foreground do tipo health e notificação silenciosa de treino. MeasureClient é destinado a medições curtas e não será usado como assinatura permanente.

Iniciar a coleta a partir de ação visível no relógio, após consentimento/permissão; mantê-la durante o treino para evitar aquecer o sensor a cada série. Parar ao encerrar/desativar a coleta. Trabalhar com a tela apagada sem manter a tela acesa nem o processador permanentemente acordado.

Conservar a configuração SDK35 existente nesta etapa. Declarar e solicitar a permissão conforme a política do target atual, verificando o mapeamento efetivo no Ultra com Wear OS6. Não alterar SDKs globalmente para contornar permissões. Negativa/revogação da permissão e falhas do serviço devem aparecer como indisponibilidade de leitura.

Consultar capabilities do aparelho antes de configurar o exercício. Não encerrar nem substituir um treino pertencente a outro aplicativo. Se houver conflito com uma coleta de outro app, informar indisponibilidade e continuar o OpenGym sem batimentos. Recuperação de um exercício pertencente ao OpenGym exige confirmação do contexto correto.

Usar timestamps do sensor relacionados ao relógio monotônico do Wear OS; converter para tempo relativo ao início da marcação. Não tratar o instante de entrega de uma amostra atrasada como instante em que ela foi medida. Não interpolar lacunas como se fossem leituras reais. Valores sem sinal/qualidade válida são descartados.

## Marcação e transporte

Ampliar o protocolo atual com iniciar/cancelar marcação e transferência de medição. A validação continua exigindo aparelho compatível, contexto opaco atual, alvo atual, revisão e requestId. O celular gera identificador opaco por marcação; ele vincula exercício/série/lado de forma estável mesmo se índices de outras linhas mudarem. Esse identificador de transporte não entra em exportações compartilhadas.

O relógio registra o instante do toque inicial e guarda leituras relevantes enquanto aguarda confirmação. Pedido rejeitado descarta a marcação; não altera a conclusão da série. O fim do esforço usa o toque de conclusão e a recuperação termina no toque de início seguinte ou encerramento da coleta. Atrasos de confirmação não ampliam nem deslocam esses intervalos. Se o próximo início for rejeitado, ele não fecha definitivamente a recuperação anterior.

Guardar no relógio uma fila pequena e privada de medições ainda não confirmadas, separada do cache visual. Transportar em blocos de no máximo 16KiB pelo mesmo canal autenticado. Confirmar cada bloco e deduplicar reenvios. A fila contém somente marcações autorizadas para o contexto, nunca comandos offline para concluir séries.

Se a conclusão do treino for confirmada e as leituras ainda não tiverem chegado, salvar a série e mostrar medição pendente. Ao reconectar, anexar somente ao alvo originalmente vinculado; nunca ao exercício atualmente visível. O celular confirma recebimento apenas após gravação local durável. Troca de conta não envia a fila à conta nova. Descarte do treino invalida suas medições pendentes.

Limites: até 300 pontos de gráfico por série incluindo recuperação, redução conservando primeiro/último, extremos e a fronteira entre esforço e descanso; resumos calculados separadamente por fase sobre todas as leituras válidas disponíveis antes dessa redução. Até 200 séries pendentes e 2MiB de fila por contexto no relógio; ao atingir limite, parar de acrescentar dados e marcar a medição como parcial, sem apagar dados silenciosamente. Resumos e gráficos devem respeitar o limite de documento de histórico existente.

## Persistência e privacidade

Adicionar um objeto opcional de medição à série/lado, com versão, início, fim do esforço, fim da recuperação e motivo de encerramento, unidade bpm, origem Galaxy Watch, contagens/resumos por fase, marcos de recuperação, pontos relativos e estado completo/parcial/sem leituras. Séries antigas continuam válidas e sem esse campo. A recuperação pode continuar pendente depois de a série ser gravada; anexar atualizações ao mesmo vínculo, inclusive ao treino recém-finalizado, sem alterar a conclusão ou a progressão.

Separar vínculos de transporte e filas do conteúdo exportável. Nenhum token de contexto, proprietário, nodeId ou requestId acompanha backups compartilhados. Os dados de frequência fazem parte do histórico do treino e seguem suas configurações atuais de backup/sincronização; não criar uploads ou integração com Samsung Health externos. Explicar isso ao ativar a coleta. Não configurar Firebase de produção.

Verificar preservação em finalizar treino, editar histórico, undo, exportar/importar e codec cloud. Limitar e validar payloads antes de persistir; não aceitar médias/picos incoerentes ou anexos para séries inexistentes. A gravação de métricas não modifica volume, PR, progressão ou unidades de carga.

## Critérios de aceitação

- Permissionamento positivo/negativo no Ultra; treino continua sem leitura quando negado.
- Leitura real com tela apagada, aquisição inicial e interrupção de sinal sem valores inventados.
- Iniciar/concluir marca o esforço, e o descanso continua vinculado à série anterior até o próximo início confirmado ou encerramento da coleta. Esforço e recuperação têm resumos distintos.
- Marcos de 30/60/120 segundos usam leituras reais dentro da janela definida; não atravessam o início seguinte. O timer terminar, ser pausado ou estendido não encerra nem desloca a recuperação.
- Lados e supersets preservam seus alvos; tipos não suportados não recebem intervalos fictícios.
- Duplicação, atraso, desconexão/reconexão, troca de conta/sessão e remoção de série não cruzam dados.
- Gravação durável e round-trip de histórico/backup/codec conservam métricas sem tokens.
- Resumo/gráfico visíveis no celular, com dados parciais identificados e medidas antigas ausentes tratadas corretamente.
- Testes relevantes JS/JVM, builds mobile/cloud e teste físico com frequência real no Ultra; testes sintéticos não substituem a evidência do sensor.

## Referências

- https://developer.android.com/health-and-fitness/health-services/active-data
- https://developer.android.com/health-and-fitness/health-services/permissions
- https://developer.android.com/health-and-fitness/health-services/active-data/measure-client
- Integração atual: `frontend/src/lib/wear-*`, `frontend/android/wear`, `frontend/src/views/Workout.jsx` e codec de histórico existente.
