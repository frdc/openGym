# Sincronização Wear por eventos e diagnóstico

Usuário relata lentidão forte no Android após fechar o app do relógio e pedir abertura novamente, com falha de reconexão. Autoriza repensar o fluxo e incluir debug visível. Preferência anterior: implementar sem novas perguntas de aprovação; manter a branch existente e preservar dados/pendências.

## Evidência inicial

Três reproduções observadas antes de alterar produção: 25 eventos apenas de UI provocam 26 drenos nativos; uma publicação retida seguida de 30 mudanças faz a reabertura esperar 30 publicações; conciliar três vezes uma captura iniciada no relógio e concluída no celular regrava a série três vezes. São defeitos reproduzidos, ainda sem medição no aparelho físico deste relato.

## Abordagem escolhida

Manter diário/manifestos privados e os ACKs duráveis existentes; corrigir a orquestração. Aumentar timeouts manteria a fila acumulando; reescrever o transporte/persistência aumentaria o risco para as medições. A escolha do implementador é um fluxo por eventos com trabalho agrupado, verificações idempotentes e diagnóstico local sem dados pessoais.

- Uma publicação em andamento e uma atualização mais recente pendente. Pedidos de snapshot são agrupados por nó, preservando o handshake manual separado; nenhuma ação ou medição é descartada por esse agrupamento. Pedidos substituídos liberam sua proteção de CPU sem ACK de aplicação.
- A UI do Android só solicita snapshot ao mudar dados relevantes (treino, unidade/idioma, timer sem ticks, estado de edição). Contagem regressiva, toast e status de nuvem não drenam inbox nem percorrem histórico. Inbox acorda em entrada nativa, prontidão/troca de dono e retomada nativa; tentativas retidas continuam duráveis.
- Conciliação cardíaca mantém limites já confirmados no treino. Pedidos simultâneos de conciliação viram trabalho único com mais uma passagem se os dados mudarem durante a execução. Adoção histórica é reutilizada enquanto as referências duráveis não mudarem; repetição/on-demand mantém a barreira de gravação.
- Receber um estado no relógio atualiza a tela e reenvia trabalho pendente, sem pedir outro estado como resposta automática. O pull periódico/reconectar permite somente um pedido em andamento, com expiração e correlação; pausa invalida callbacks antigos.
- Diagnóstico em Opções do relógio na versão debug: telefone alcançável, idade/revisão do estado, RX/TX, ações e capturas pendentes, última confirmação e etapa/erro. Buffer e contadores em memória, sem gravar em cada tick. Logs Android/Wear registram contagens, durações e códigos; nunca nome do treino, batimentos, conta, tokens ou payload completo.

## Contratos mantidos

Aceitar filas v1 e autorização v2, dono confirmado, alvos estáveis e recibos persistidos. Nada de limpar dados, pendências ou descartar capturas. Layout de treino/descanso permanece igual. Não operar `0123456789ABCDEF`, publicar main, trocar dependências ou iniciar visualizador de movimento. Instalação usa os aparelhos conhecidos após identificação, se acessíveis.

## Verificação

Regressões das três reproduções; rajadas/lentidão/falha do plugin, dois tipos de pull e troca de dono; retomada e callbacks fora de época; cópias/curvas e importação histórica existentes; diagnóstico sem identificadores; JVM e testes de UI em emulador; suíte web e builds/APKs. Reabrir app é teste distinto de concluir série offline com sensor real. Relatar separadamente o que foi medido em aparelho e o que foi automatizado.
