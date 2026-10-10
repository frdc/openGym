# Integração básica com Galaxy Watch Ultra

## Objetivo e escopo aprovado

Validar no relógio físico uma primeira integração do OpenGym: mostrar exercício e série atuais, concluir uma série com um toque e acompanhar descanso com vibração no final. O usuário aprovou essa versão básica para avaliar se funciona. Batimentos serão apenas referência em uma etapa posterior; não fazem parte desta versão.

## Abordagem

Adicionar um módulo Android Wear OS nativo em `frontend/android/wear`, acompanhado de uma ponte Capacitor no app de celular. Usar Google Play Services Wearable Data Layer para estado e comandos entre os aparelhos pareados. O celular continua sendo a autoridade do treino e do armazenamento; o relógio funciona como controle remoto.

Alternativas consideradas: espelhar apenas notificações aproveita o timer existente, mas não atende à conclusão de séries; tornar o relógio independente exigiria armazenamento, conflitos e sincronização adicionais. O módulo acompanhante é a opção adequada para o escopo aprovado.

## Experiência

Iniciar o treino pelo celular e abrir OpenGym no relógio. A tela circular mostra nome do exercício, posição da série, repetições e carga planejadas nas unidades atuais. Um botão grande conclui a série usando esses valores. Alterações de carga/repetições continuam no celular nesta versão.

Depois da confirmação pelo celular, mostrar a próxima série e o descanso restante. Oferecer pausar/retomar, +15 segundos e pular descanso conforme os controles existentes. Ao finalizar, vibrar uma vez. Treino encerrado mostra que não há treino ativo.

Exercícios especiais devem conservar as regras atuais, incluindo supersets, lados e séries temporizadas. Quando uma etapa não puder ser concluída com segurança por um toque, mostrar orientação para usar o celular; não inventar uma conclusão alternativa.

## Estado e protocolo

Extrair uma projeção pequena e testável do treino atual: versão do protocolo, identificador opaco de contexto, revisão, exercício/série elegíveis, valores exibidos e estado do timer. Não enviar Firebase UID, credenciais, histórico completo, catálogo ou mídia.

Publicar a projeção por DataClient e comandos por MessageClient. Cada comando inclui identificador único, contexto, revisão e alvo. O celular valida aparelho remetente, contexto atual, série elegível e comando antes de chamar os caminhos existentes do treino. Comandos duplicados não concluem uma segunda série; comandos antigos ou de outra sessão são rejeitados. O relógio só exibe sucesso após confirmação; um timeout pede reconexão e atualização de estado.

Troca de conta, encerramento do treino e mudança de sessão invalidam o contexto. O relógio recebe uma projeção vazia e descarta comandos pendentes. Não usar dados persistidos no relógio como autoridade para reconstruir treinos.

## Conectividade e timer

Não exigir conexão à internet para o uso local com os aparelhos conectados. Mostrar perda de conexão e desabilitar conclusão de séries quando não houver confirmação de estado atual. Não enfileirar conclusões offline.

O relógio calcula a contagem a partir do instante final sincronizado, sem depender de mensagens a cada segundo. Pausa, retomada, ajuste e cancelamento substituem o timer pelo token atual. Implementar alerta nativo no relógio para funcionar com tela apagada, invalidado ao receber cancelamento ou substituição. Na perda de conexão, indicar que o timer é o último recebido: uma mudança no celular durante a desconexão pode impedir o cancelamento remoto. Evitar alerta duplicado no relógio pelo espelhamento da notificação do celular quando o módulo estiver ativo; preservar o alarme do celular.

## Execução em segundo plano

A ponte deve encaminhar comandos apenas com o estado do treino carregado e pronto. Se o Android encerrar o processo ou suspender a WebView de forma que a confirmação não possa ocorrer, retornar indisponibilidade ou expirar a operação, sem registrar sucesso. Desbloquear/abrir OpenGym no celular restaura o estado e permite tentar novamente. A validação no aparelho determinará se essa limitação compromete o uso e exige uma etapa posterior de execução nativa.

## Build e entrega para teste

Produzir APKs debug separados de celular e relógio com applicationId correspondente e mesma assinatura de desenvolvimento. Preservar a variante debug `.test`, para coexistir com o app instalado. Não publicar nem configurar Firebase de produção. Documentar instalação via ADB e teste no Galaxy Watch Ultra; instalação no aparelho depende de acesso e pareamento de depuração disponíveis.

## Verificação e critérios de aceitação

Testar projeção, comandos duplicados/antigos, troca de sessão/conta e transições de timer. Compilar ambos os módulos e executar os checks pertinentes do frontend/mobile. No aparelho, verificar: iniciar treino; atualizar exercício/série; concluir exatamente uma série; iniciar descanso; pausar/ajustar/pular; vibrar com tela apagada; recuperar conexão; rejeitar estado antigo; comportamento com celular bloqueado e processo encerrado.

Compilação e testes automatizados não comprovam funcionamento no Galaxy Watch Ultra. Reportar separadamente resultados locais e evidência física. A primeira versão só será considerada validada no relógio após esses testes físicos.

## Referências

- https://developer.android.com/training/wearables/data/client-types
- https://developer.android.com/training/wearables/data/data-items
- https://developer.android.com/training/wearables/data/events
- `README.md`, `CLAUDE.md`, `docs/MOBILE.md`, `frontend/src/lib/rest-alert.js`, `frontend/src/store/useUI.js` e o serviço Android de descanso existente.
