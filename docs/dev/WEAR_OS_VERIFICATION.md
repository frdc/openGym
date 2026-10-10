# OpenGym no Galaxy Watch Ultra — versão básica

## Uso e limites

Esta versão é um controle acompanhante: iniciar e abrir o treino no celular, abrir OpenGym Watch Test no relógio e concluir a série com os valores planejados. Carga/reps são alteradas no celular. O celular confirma a gravação local antes de informar sucesso ao relógio. Não coleta frequência cardíaca nesta etapa.

Supersets e lados usam a seleção existente do OpenGym. Séries temporizadas, cardio, dropsets e rest-pause pedem uso do celular. Quando a tela Workout não estiver montada, uma janela estiver aberta ou houver um timer de trabalho, a conclusão fica indisponível; o descanso continua sincronizado. O relógio oferece pausar/retomar, +15 s e pular descanso.

Manter data/hora automáticas nos dois aparelhos: o timer usa o instante final do celular. Permitir alarmes pontuais e notificações pelos botões do app no relógio. Sem permissão de alarme pontual, a UI informa a limitação e não promete vibração pontual com tela apagada. A preferência de vibração segue o celular.

A conexão usa Wear OS Data Layer (Bluetooth ou roteamento do Google Play Services). Não exige internet quando existe conexão Bluetooth. Os aparelhos precisam estar pareados e ambos os APKs precisam ter o mesmo applicationId e certificado. A versão web/PWA não controla o relógio.

Sem confirmação recente do celular, os botões ficam desabilitados. Após oito segundos sem resposta de comando, conferir no celular antes de tentar novamente: uma mensagem pode ter sido aplicada sem a resposta ter chegado. Não há fila de conclusões offline. Android/WebView suspensos podem impedir a conclusão até abrir o celular. O timer já recebido continua no relógio; cancelamento/alteração durante desconexão pode não chegar. A UI identifica o último timer recebido.

O relógio confirma a ocorrência do timer que conseguiu agendar. O celular suprime espelhamento apenas para esse token e instante final, preservando o alarme no celular. Se ainda não houve confirmação de agendamento, o espelhamento pode ocorrer como alternativa e produzir dois alertas; verificar esse caso no aparelho.

## APKs debug locais

- Celular: `frontend/android/app/build/outputs/apk/debug/app-debug.apk`.
- Relógio: `frontend/android/wear/build/outputs/apk/debug/wear-debug.apk`.
- Ambos: `ch.duartesantos.opengym.test`, assinatura debug local. Coexistem com a versão release sem substituí-la. Não são releases para distribuição.

## Instalação para teste

Instalar o APK do celular e o do relógio nos aparelhos correspondentes. Ativar opções do desenvolvedor e depuração sem fio no Galaxy Watch Ultra. Os endereços/portas são os exibidos no próprio relógio; porta de pareamento e porta de conexão podem ser diferentes.

```powershell
adb pair IP_DO_RELOGIO:PORTA_DE_PAREAMENTO
adb connect IP_DO_RELOGIO:PORTA_DE_CONEXAO
adb devices -l
adb -s SERIAL_DO_CELULAR install -r frontend/android/app/build/outputs/apk/debug/app-debug.apk
adb -s SERIAL_DO_RELOGIO install -r frontend/android/wear/build/outputs/apk/debug/wear-debug.apk
```

Executar os comandos na raiz do repositório, usando os seriais da listagem e o código de pareamento solicitado pelo ADB. Não usar `-r` em uma instalação com outra assinatura; não desinstalar uma versão existente para contornar conflito sem preservar seus dados. A variante debug pode abrir vazia; usar treino local de teste ou importar backup pelos controles normais do app.

## Checklist físico (pendente)

- [ ] Abrir treino de teste no celular e conferir exercício, série, carga e reps no Ultra.
- [ ] Concluir série e verificar exatamente uma conclusão e descanso no celular.
- [ ] Tocar duas vezes e confirmar que não conclui a próxima série.
- [ ] Pausar, retomar, acrescentar 15 s e pular descanso.
- [ ] Bloquear tela do relógio e verificar vibração no final com permissões concedidas.
- [ ] Desligar vibração no celular durante descanso e confirmar ausência de vibração.
- [ ] Estender descanso após o alerta e confirmar alerta da nova ocorrência.
- [ ] Verificar supersets/lados; séries especiais devem pedir o celular.
- [ ] Trocar de sessão/conta e confirmar rejeição de comando antigo e atualização da tela.
- [ ] Desconectar e confirmar controles bloqueados e indicação de último timer; reconectar.
- [ ] Bloquear celular e repetir conclusão; encerrar processo e confirmar indisponibilidade, nunca falso sucesso.
- [ ] Confirmar supressão de espelhamento quando o timer do relógio foi reconhecido.

## Evidência local

Implementação revisada por agente independente; ajustes de extensão do alarme e preferência de vibração incorporados. Suítes JS cobrem protocolo, projeção, controlador e ponte com store/plugin simulados; testes JVM cobrem validação de caminhos, reconhecimento da ocorrência, revisões, expiração de controle e deduplicação de alertas. Compilação não prova funcionamento físico.

Em 2026-10-09, `adb devices -l` não listou aparelhos. O checklist físico permanece pendente. Os resultados finais de build/teste são registrados ao concluir a execução; nenhuma instalação ou publicação foi feita.

Resultados finais em 2026-10-09:

- `npm test`: 345 arquivos, 3.794 testes aprovados.
- `npm run test:build-scripts`: 6 testes aprovados.
- `node scripts/check-locales.mjs`: 17 idiomas, 2.006 chaves por idioma.
- `npm run build`, `npm run check:cloud-bundle`, `npm run build:mobile`: aprovados; assets Android conferidos byte a byte.
- Gradle `:app:testDebugUnitTest :wear:testDebugUnitTest :app:assembleDebug :wear:assembleDebug`: BUILD SUCCESSFUL; 7 testes JVM aprovados no conjunto.
- `git diff --check`: sem erros.
- `aapt dump badging`: ambos os APKs identificados como `ch.duartesantos.opengym.test`.
- `apksigner verify --print-certs`: ambos válidos, com certificado SHA-256 `1ecece815abe212393958030743e0954ea5b1d3274ac65fe03f55b7b5f657ef1`.

SHA-256 dos APKs desta entrega:

| APK | SHA-256 |
| --- | --- |
| Celular | `546f5f9001d27b79d1ff756302168c253120e57369b4b970a2881ca8e5d34213` |
| Relógio | `daeabdac1cbc53a49a119ed79b52c623f96f9cbd62f54b8ddac6677d5269adf1` |

Os testes completos foram executados fora do sandbox porque os testes existentes de subprocessos/servidores e o cache Gradle exigem esse acesso. A tentativa inicial no sandbox não foi usada como evidência de aprovação.

## Correção após teste no Galaxy Watch Ultra (2026-10-09)

Os APKs foram instalados no Ultra e no celular pareado. O usuário confirmou que exercício e série apareceram. O checklist completo de treino continua pendente.

O diagnóstico do relógio confirmou POST_NOTIFICATIONS concedida e SCHEDULE_EXACT_ALARM em allow. Duas tentativas de vibração do OpenGym tinham `usage: UNKNOWN` e resultado `ignored_background`: faltavam atributos de alarme, apesar das permissões concedidas. O app também não tinha Ongoing Activity para representar o treino no Wear OS.

Correções: WearHaptics usa USAGE_ALARM (VibrationAttributes em API33+ e AudioAttributes nas anteriores); WearOngoing registra uma atividade de treino com notificação local, silenciosa e sem vibração. O indicador permite voltar ao app e ajuda a preservá-lo durante o treino. Não mantém a tela iluminada permanentemente.

Verificação: `:wear:testDebugUnitTest :wear:assembleDebug :wear:assembleDebugAndroidTest` aprovados. Dois testes instrumentados passaram no Ultra: atributos/vibração de alarme e criação/cancelamento de notificação ongoing silenciosa. O teste inicial de cancelamento encontrou assincronia do NotificationManager; a versão final espera a atualização e usa ID separado para não interferir no treino atual. Logs físicos registraram duas vibrações USAGE_ALARM com resultado `finished`, em vez de `ignored_background`. A notificação de treino apresentou ONGOING_EVENT, ONLY_ALERT_ONCE, LOCAL_ONLY e SILENT, canal sem som/vibração. Após KEYCODE_SLEEP, 25 segundos e KEYCODE_WAKEUP, o WindowManager manteve WearActivity como mFocusedApp. O retorno por gesto do pulso e o fluxo completo de descanso ainda precisam de confirmação do usuário.

APK do relógio atualizado e instalado; SHA-256 atual: `eaaaecc8543ab5054e2378aa755b1f361f2d434e1cb560e8870c50fcf318bdee`. O APK do celular não mudou nesta correção.

## Abrir no relógio pelo celular (2026-10-09)

O treino no app Android agora oferece **Abrir no relógio**. O botão publica o estado atual e envia uma solicitação autenticada pela Data Layer ao único acompanhante compatível conectado. A interface confirma apenas o envio; abertura depende do sistema. Não abre automaticamente a cada atualização do treino.

O relógio valida versão, validade de 30 segundos, estado ativo, aparelho remetente e requestId; rejeita mensagens repetidas/antigas. O celular revalida contexto/revisão contra o último estado publicado depois da descoberta assíncrona do relógio, e mantém o timestamp original da solicitação para impedir que uma resposta atrasada restaure um treino anterior.

A solicitação tenta trazer WearActivity ao primeiro plano com `setTurnScreenOn(true)`. Uma notificação silenciosa de acesso ao treino permanece como alternativa se o sistema bloquear a abertura; ela é removida quando a tela do app retoma. Não contorna PIN ou bloqueio do aparelho.

Evidência física: com celular desbloqueado e treino aberto, Galaxy Watch Ultra na tela inicial e apagado por KEYCODE_SLEEP, o botão foi acionado no celular. Em três segundos, WindowManager mostrou WearActivity como mCurrentFocus/mFocusedApp e PowerManager registrou `mWakefulness=Awake`. ActivityTaskManager confirmou START com `BAL_ALLOW_TOKEN`, resultado 0. A notificação de alternativa ID44 já havia sido removida. Portanto, a abertura e o acendimento funcionaram neste Ultra e nesta versão do sistema.

Verificação: 3.795 testes JS aprovados em 345 arquivos; traduções sincronizadas em 17 idiomas/2.009 chaves; build mobile e cloud bundle aprovados; nove testes JVM e ambos os APKs compilados. O teste da ponte e os testes de validade/contexto foram observados falhando antes da implementação/correção. Revisão independente encontrou a corrida de contexto e ela foi corrigida. APKs atualizados instalados nos dois aparelhos; dados do treino preservados com `install -r`.
