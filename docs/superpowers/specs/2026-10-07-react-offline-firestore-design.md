# OpenGym React com persistência offline e Firestore

Data: 7 de outubro de 2026. Base examinada: `ce30c7304bdeb66a6eb4a3d14821a06035523b06`.

Status: desenho em conversa aprovado; especificação escrita para revisão do usuário. Implementação e publicação ainda não iniciadas.

## 1. Objetivo e decisões aprovadas

Transformar o OpenGym em uma versão melhorada do app pessoal do usuário, conservando suas funcionalidades de treino, removendo o Coach e garantindo salvamento no aparelho com sincronização persistente no Firestore.

O usuário escolheu React, web/PWA e Android via Capacitor. Também pediu o mínimo de dependências possível para reduzir manutenção e superfície de risco. O desenho aprovado acrescenta apenas o pacote oficial `firebase` como dependência direta. Bibliotecas de interface, estado e integração nativa já usadas pelo OpenGym continuam quando sustentarem recursos preservados.

O app deve registrar e consultar treinos sem internet, recuperar alterações após fechar e reabrir, e sincronizar quando houver conexão e autenticação válida. A interface distingue uma alteração em memória, uma gravação local confirmada e uma sincronização confirmada pelo servidor.

O projeto Firebase existente é `workout-tracker-e0c6c`. A nova aplicação reutiliza Firebase Auth, mas guarda seus dados em um namespace separado. Esta etapa não importa automaticamente o histórico do workout-tracker2 nem altera seus exercícios, treinos, sessões, medicamentos ou usuários.

Fotos e vídeos próprios permanecem locais nesta versão. Lembretes e alarmes locais do Android continuam. Sincronização de arquivos e notificações web com o navegador fechado ficam fora desta implementação, como apresentado na aprovação do desenho.

## 2. Escopo funcional

Preservar rotinas, agenda semanal e rotação, treino em andamento, histórico, progressão, tipos de séries, descanso, cargas, RIR/RPE, estatísticas, recuperação muscular, peso corporal, exercícios personalizados, QR de academia e importação/exportação local. Preservar o catálogo de exercícios e a configuração existente de imagens/GIFs estáticos.

Remover o Coach das rotas, menus, configurações, estado, chaves, integrações, adaptadores de provedores, código executável, testes específicos e documentação de uso da versão adaptada. Filas/rotações importadas anteriormente continuam legíveis como dados de treino; textos que mandam consultar o Coach passam a descrever a rotação ou o plano. Remover código de IA não autoriza apagar rotinas criadas por ele.

Firebase Auth substitui login por passkeys/sessões do Node e pareamento com servidor. A aplicação usa email/senha, cadastro pelo SDK oficial, restauração de sessão, saída e recuperação de senha. Cadastro depende do provedor email/senha já habilitado no projeto e mostra erro de configuração se ele estiver desabilitado; esta etapa não habilita provedores nem cria contas administrativas automaticamente. Um login novo requer internet. Uma sessão já restaurada pode usar os dados locais offline.

O backend Node deixa de ser necessário para executar esta versão. Administração do servidor antigo, convites, pareamento, Web Push e a ponte MCP que lê seus arquivos não entram nos artefatos de execução novos. Ajustar build, hospedagem estática, CI e documentação para refletir essa arquitetura, preservando licença e atribuições do projeto.

Não acrescentar módulos de medicamentos, redesign visual, outro framework, analytics, Cloud Functions ou migração do app antigo nesta etapa.

## 3. Dependências e limites dos componentes

| Componente | Responsabilidade | Dependências |
| --- | --- | --- |
| React, Router e Zustand existentes | Telas e estado `S` consumido pela interface | Pacotes existentes |
| Inicialização Firebase | Configuração pública por ambiente; inicialização única de App/Auth/Firestore | Módulos oficiais de `firebase` |
| Adaptador Auth | Restaurar sessão e administrar login/saída; identificar o proprietário ativo | Firebase Auth |
| Codec de estado | Converter `S` em documentos, calcular alterações e reconstruir o estado; excluir dados locais do transporte | Helpers puros existentes |
| Armazenamento offline | Salvar estado e operações pendentes juntos; hidratar, recuperar e notificar outras abas | IndexedDB nativo ou Filesystem do Capacitor já instalado |
| Coordenador de sincronização | Listeners, transações, conflitos, confirmação e retomada | Firestore, codec e armazenamento offline |
| Mídia local existente | Guardar bytes e associações de fotos/vídeos no aparelho | IndexedDB/Filesystem existentes |

O formato `S` permanece o contrato da UI. Metadados de transporte, filas, identidade e tokens ficam fora dele e dos backups compartilháveis. Extrair as responsabilidades novas de `useStore.js`, sem reescrever as regras de progressão, 1RM ou recuperação.

Importar apenas `firebase/app`, `firebase/auth` e `firebase/firestore`, em estilo modular. Não importar `compat`, Analytics ou Storage nesta versão. Fixar a versão escolhida e registrar o lockfile; revisar dependências transitivas e avisos de segurança na implementação. Um único pacote direto ainda pode possuir dependências transitivas.

Retirar `@aparajita/capacitor-secure-storage`, cujo consumidor atual é o armazenamento de chaves do Coach. Retirar `undici` e o SDK opcional de Claude junto do Coach; dependências do servidor antigo saem dos artefatos novos quando seus consumidores forem removidos. Manter Capacitor, seus plugins necessários, QR, Vite e ferramentas de teste existentes. Não adicionar biblioteca de IndexedDB, SQLite, framework de sincronização ou ferramenta de validação apenas para esta mudança.

## 4. Persistência local

### Identidade e envelope

A chave de armazenamento contém projeto Firebase, namespace `apps/opengym` e UID. O perfil convidado tem chave própria. Mídia e associações também respeitam esse proprietário, mesmo quando bytes idênticos são deduplicados no aparelho.

Um envelope versionado contém:

```text
schemaVersion
ownerKey = projectId + namespace + uid, ou guest
localRevision
cloudGeneration
state = S
remoteMetadataByPath
pendingOperations = [{ opId, ownerKey, generation, kind, paths, payloads }]
pendingJobs
adoptionDecision
```

IDs de operação são gerados antes de gravar localmente ou abrir uma transação remota. Revisões aumentam de forma monotônica por proprietário. As operações contêm somente os documentos afetados, nunca uma cópia inteira de `S` por alteração. Alterações simples repetidas podem ser compactadas quando isso preservar sua ordem e seus metadados de conflito; operações de finalizar treino, reset e importação conservam sua identidade e conjunto de efeitos.

### Navegador/PWA

IndexedDB nativo é a fonte principal para estado e fila. Gravar ambos em uma transação e só confirmar salvamento no evento de conclusão. Para múltiplas abas, ler e mesclar a revisão persistida dentro da mesma transação, ou realizar compare-and-swap com nova tentativa. Uma escrita de snapshot antigo nunca pode eliminar o treino ou a fila salvos por outra aba.

Usar notificação entre abas disponível no navegador e reler a revisão confirmada. O treino ativo pertence ao perfil local do navegador; preservar a regra atual que evita uma aba sem treino sobrescrever o treino em andamento de outra.

Separar `localReady`, restauração de Auth e disponibilidade da nuvem. Enquanto a hidratação inicial não terminar, a UI de treino não aceita alterações em um estado provisório vazio. A cópia local fica utilizável sem esperar uma resposta do Firestore.

Falha ao abrir IndexedDB, quota ou escrita abortada produz status explícito de falha de salvamento. A versão em memória pode permanecer disponível para tentar novamente ou exportar, mas não aparece como salva. Não usar a memória como substituto silencioso da persistência.

Solicitar armazenamento persistente do navegador quando a API estiver disponível, sem tratar a concessão como garantida. Limpar os dados do site, desinstalar o app ou perder o aparelho pode remover a cópia local; a cópia já confirmada no Firestore continua independente.

### Android

Usar o Filesystem existente para envelopes por proprietário, com gravações serializadas e dois slots versionados. Escrever no slot alternativo, reler e validar revisão, proprietário e conteúdo antes de confirmar. Na abertura, escolher a maior revisão válida; se a última gravação foi interrompida, conservar o slot anterior.

Estado e fila vivem no mesmo envelope. Não separar a identidade em um arquivo cuja escrita independente poderia associar dados à conta errada. Não interpretar apenas o sucesso de `writeFile` ou `rename` como comprovação de uma recuperação atômica.

Cada alteração inicia sua gravação local sem o debounce atual de 800 ms do espelho. A UI continua responsiva, mas só marca a revisão como salva após confirmação. Finalizar treino, trocar de conta, sair e mandar o app ao background solicitam flush explícito. Encerramento antes da confirmação pode perder uma alteração ainda indicada como não salva; encerramento depois da confirmação deve recuperar aquela revisão.

### Migração dos arquivos locais existentes

Ler `gym_state_v1`, seus metadados e `opengym-state.json`/arquivo de proprietário existentes. Migrar apenas cópias com proprietário consistente. Dados sem proprietário confiável ficam como cópia local recuperável, sem envio automático para a primeira conta Firebase que entrar.

Gravar e reler o envelope novo antes de marcar a migração como concluída. Manter a origem intacta como recuperação durante esta etapa; uma interrupção repete a migração de forma idempotente. IDs de registros existentes permanecem estáveis. Não usar a função destrutiva de sincronização do workout-tracker2 como migração.

## 5. Modelo Firestore

Documento de controle: `users/{uid}/apps/opengym`. Contém somente versão de esquema, geração do perfil e metadados pequenos de inicialização/reset. Não escrever no documento `users/{uid}` nem nas coleções antigas `exercises`, `workouts`, `workoutSessions`, `medicines` ou `medicineLogs` diretamente abaixo dele.

Subcoleções do documento de controle:

| Caminho relativo | Conteúdo |
| --- | --- |
| `settings/{field}` | Preferência sincronizável individual; objetos pequenos como controles e lembrete mantêm seus stamps |
| `plans/main` | Modo de agenda, rotação, fila e ordem das rotinas |
| `planDays/{key}` | Uma atribuição de dia semanal ou exceção por data |
| `routines/{id}` | Uma rotina e seus exercícios/séries planejados |
| `workouts/{id}` | Um treino concluído e suas entradas/séries |
| `bodyweight/{date}` | Uma pesagem diária, conforme a identidade usada no modelo atual |
| `customExercises/{id}` | Um exercício próprio, sem arquivos ou URIs locais |
| `exerciseState/{id}` | Carga/progressão, nota, favorito, barra e modo de anilhas por exercício, com stamps por campo |
| `equipmentProfiles/{id}` | Um perfil de equipamentos |
| `gymCards/{id}` | Um cartão de academia |
| `balanceOverrides/{key}` | Uma configuração de equilíbrio muscular |
| `plates/{unit}` | Inventário de anilhas daquela unidade |
| `jobs/{jobId}` | Manifest pequeno de importação, alteração global de unidade ou limpeza após reset |
| `jobs/{jobId}/parts/{partId}` | Metadados de uma parte limitada do job; nunca uma lista crescente no documento pai |

Cada entidade carrega versão, geração, identidade estável, payload, stamps de campos e informação de exclusão quando aplicável. Pesos carregam `dataUnit` explícita. Preservar os stamps existentes usados por `stampChange`, `mergeEntry` e `mergeStates`, em vez de tratar todo o perfil como uma única escrita.

IDs de documentos usam codificação determinística e segura para caminhos. Treinos importados sem ID recebem um ID determinístico derivado da identidade histórica atual, persistido antes do primeiro envio. Repetir importação ou uma operação após queda de conexão não cria outro treino.

Não armazenar o perfil inteiro em um documento. O servidor atual já descreve perfis de 2,4 MB; o [limite de documento do Firestore é 1 MiB](https://firebase.google.com/docs/firestore/quotas). Validar tamanho e formato antes de tentar um envio. A operação inválida fica durável com status bloqueado. Um documento individual acima do limite permanece recuperável localmente, com erro identificando o registro; não truncar séries nem histórico para conseguir sincronizar.

Excluir do transporte `active`, credenciais, configuração de aparelho, filas locais e mídia própria. Conservar associações locais de mídia como overlay por identidade de entidade/hash ao receber dados remotos. Fotos de exercícios e de treinos continuam disponíveis no aparelho que as guardou. Links públicos de catálogo e mídia estática já existentes não passam a ser uploads Firestore.

O codec deve ter classificação explícita de todos os campos persistentes atuais de `S`: sincronizado, derivado ou local. Um teste acusa campo novo sem classificação, evitando perda silenciosa de preferências ou vazamento de dados locais.

## 6. Fluxo de sincronização e conflitos

1. Hidratar o proprietário local e restaurar Firebase Auth. Um callback inicial ainda pendente não significa logout.
2. Quando Auth confirmar um UID, abrir somente seu envelope, associar listeners a uma geração de autenticação e consultar o namespace novo.
3. Mostrar imediatamente dados locais. Snapshot vazio de cache, erro de rede ou falta de permissão não prova que a conta remota está vazia. Inicializar o controle somente após leitura confirmada pelo servidor, sem sobrescrever um controle existente.
4. Primeiro login com dados de convidado conserva a decisão explícita de adicionar a cópia local ou manter o perfil da conta. Nenhuma operação é enviada antes dessa decisão. Não misturar silenciosamente um UID antigo do Node com um UID Firebase.
5. Uma alteração grava estado e operação na fonte local. O coordenador tenta enviá-la quando houver sessão válida e servidor acessível. Indicador de rede é apenas um sinal; sucesso/falha da operação determina seu estado.
6. Para cada operação, uma transação Firestore lê o controle e todos os documentos afetados, verifica a geração, mescla os dados e escreve o resultado. Reutilizar/reconciliar os helpers existentes de conflito, agenda e rotação. Não substituir documentos cegamente com um snapshot local.
7. O callback da transação pode executar mais de uma vez. Ele não grava IndexedDB/arquivos, modifica Zustand, cria IDs, mostra toast ou executa outro efeito externo. Os efeitos locais acontecem depois da confirmação remota.
8. Gravar juntos o resultado confirmado, os metadados e a retirada do `opId` confirmado da fila local. Incorporar alterações locais feitas durante o envio; uma confirmação antiga não remove uma operação mais nova.
9. Listeners remotos também mesclam com dados pendentes locais antes de persistir. Uma exclusão só é aplicada respeitando seu stamp e os registros que permaneceram recuperáveis no aparelho.

Finalizar um treino é uma operação lógica: treino concluído, efeitos de progressão, agenda/rotação e demais documentos pequenos afetados são confirmados juntos em transação. IDs e atribuições são estáveis para permitir repetir após uma queda entre confirmação remota e confirmação local. Não usar incrementos remotos que duplicariam efeitos na repetição.

Importações e mudanças que atingem muitos documentos usam jobs com identidade e progresso durável. O documento pai contém versão, tipo, origem, destino, contadores e status; metadados de partes ficam em documentos separados, com até 20 IDs por parte. Dimensionar partes também pelo tamanho das leituras/escritas e pelo orçamento de acesso das regras, reduzindo o lote quando necessário. Retomar uma parte não duplica registros; o job só é concluído quando todas forem confirmadas. Não prometer uma transação ilimitada para todo o histórico. Outras telas podem ver sincronização parcial de um job, claramente indicada.

Firestore mantém suporte a cache offline, mas ele é complementar à fonte local própria. [Mudanças concorrentes cegas no mesmo documento usam a última escrita no Firestore](https://firebase.google.com/docs/firestore/manage-data/enable-offline); por isso os uploads de domínio usam as transações de merge online e a fila durável durante períodos offline.

### Unidades

Nunca inferir a unidade de um registro apenas de `settings.unit`. Normalizar unidades explicitamente antes de comparar/mesclar cargas, conservar a unidade de origem no payload e usar conversão numérica sem arredondamento de ida e volta no codec. Helpers que arredondam cargas para incrementos de academia não são serializers.

Trocar kg/lb normalmente preserva o significado físico dos registros. A opção existente de trocar unidade sem converter números reinterpreta os dados: tratá-la como job próprio, com unidade de origem/destino, modo, identidade e partes. O controle mantém uma versão numérica monotônica de unidade e a identidade do job ativo. Cada entidade numérica registra sua versão, e a transação que altera seus pesos grava também a versão aplicada. Encontrar a versão de destino significa que aquela transformação já foi confirmada. Só confirmar sincronização após aplicar e confirmar todas as partes.

Durante um job de unidade, pausar uploads normais de entidades numéricas; as alterações locais continuam salvas na fila com a versão de origem. Qualquer dispositivo da mesma conta pode retomar esse job a partir dos dados e metadados remotos. Após sua conclusão, reconciliar pendências antigas aplicando em ordem as transformações faltantes, identificadas pelos jobs de versões intermediárias, antes de permitir seu upload. Preservar esses registros pequenos de transformação para aparelhos que ficaram offline; não guardar a cadeia inteira no documento de controle. Isso evita restaurar números anteriores ou aplicar duas vezes uma transformação após queda entre confirmação remota e local.

### Exclusões e reset

Excluir uma entidade cria tombstone por documento, com geração e stamp; não acrescentar uma lista ilimitada de exclusões ao documento principal. Conservar tombstones enquanto um aparelho antigo puder reenviar sua cópia; não removê-los apenas pela idade.

Reset global confirmado pelo usuário cria uma operação imutável `{ opId, baseGeneration, nextGeneration }`, persistida localmente antes de enviar. A transação do controle troca a geração somente quando encontra `baseGeneration`. Encontrar `nextGeneration` significa repetição de um reset já confirmado; encontrar outra geração suspende essa operação para reconciliação e recuperação local, sem sobrescrever o reset de outro aparelho. Leituras da aplicação usam a geração ativa; operações normais conferem a mesma geração no controle remoto. Reset é uma ação distinta e não pode ser disparado por um merge comum.

Operações de outra geração nunca ressuscitam o histórico apagado. Pendências antigas de outro aparelho são movidas para cópia local recuperável, com informação ao usuário, em vez de descartadas ou reenviadas automaticamente. Recuperá-las exige uma importação explícita na geração nova.

Limpar documentos remotos de gerações antigas em partes retomáveis depois da confirmação do reset. A transação de cada exclusão confere que o documento ainda pertence à geração antiga visada; se o ID já foi reutilizado na geração nova, preservar o registro. O reset não depende de buscar todos os IDs e gravá-los num campo global. Se offline, mostrar o reset como salvo localmente e ainda pendente na nuvem; outros aparelhos só conhecem a nova geração após a confirmação remota.

## 7. Autenticação, privacidade e regras

Trocar de conta ou sair remove listeners e invalida callbacks pela geração de autenticação. A operação captura seu proprietário de forma imutável; nunca usa o UID que estiver ativo quando terminar. Persistir/flush da conta anterior ocorre antes de ativar a próxima.

Pendências continuam guardadas para o UID original e voltam a sincronizar quando ele autenticar novamente. Após saída explícita, esconder o perfil daquela conta. Token expirado ou rede indisponível pausa o envio sem apagar o histórico local. Não transportar tokens para `S`, backups, logs ou documentos de domínio.

Regras novas ficam restritas a `users/{uid}/apps/opengym` e suas subcoleções previstas. Autorizar somente quando `request.auth.uid == uid`; validar versão, geração ativa para escritas normais, tipos, campos permitidos e limites de payload. Testar leitura/escrita entre UIDs, acesso sem sessão e replay de geração antiga. O usuário autenticado pode ler seus registros antigos para recuperação/limpeza; a UI filtra a geração ativa.

Regras do projeto atual não estão versionadas no app antigo e permanecem desconhecidas. Preparar o trecho novo e os testes de regras sem substituir regras legadas. Antes de ativar a integração real, obter as regras implantadas e reconciliar apenas o namespace novo. Não publicar um arquivo genérico que altere as permissões do app antigo.

Configuração web Firebase é pública e vem de ambiente; não incluir credenciais administrativas ou chaves de serviço. A aplicação configurada deve funcionar sem acesso de administrador ao projeto. Se faltar configuração, apresentar o modo local explicitamente e orientar a configuração, sem falso status de sincronização.

## 8. Experiência e tratamento de falhas

Usar os componentes de status existentes para distinguir: carregando cópia local, salvando, salvo no aparelho, aguardando conexão, sincronizando, sincronizado, autenticação necessária e erro de gravação/sincronização. Preferências que ocultam o banner conservam o indicador resumido atual.

Não exigir internet para começar/finalizar um treino local. Nova autenticação, primeira leitura em outro aparelho e sincronização exigem conexão. A PWA conserva o cache do aplicativo e seus chunks para abrir offline após ter sido instalada/carregada; o APK contém o bundle local.

Falha temporária usa nova tentativa com intervalo progressivo e limite, retomando também ao reabrir/voltar ao foreground. Falha de permissão, documento inválido ou limite de tamanho é exibida e mantém a pendência recuperável; não insistir continuamente nem marcar sucesso.

Remover da UI os controles do servidor que não funcionam na arquitetura nova. Manter alarmes Android, importações locais e backups. Fotos próprias são identificadas como locais quando relevante para compreender sua disponibilidade em outro aparelho. O [Cloud Storage exige o plano Blaze](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024) e será uma decisão separada se solicitado.

Textos novos seguem o catálogo e a validação de todos os locales do projeto, incluindo português brasileiro. Nenhuma mudança visual ampla é necessária.

## 9. Critérios de aceitação e verificação

- Criar/editar rotina, iniciar treino, marcar séries, finalizar, fechar e reabrir offline: estado, treino ativo ou concluído e pendências permanecem.
- Depois de reconectar, histórico e efeitos de progressão aparecem no segundo aparelho da mesma conta, sem duplicação.
- Reload entre confirmação Firestore e confirmação local repete a operação de forma idempotente.
- Duas abas editando ao mesmo tempo conservam os dois conjuntos de alterações e o treino ativo correto.
- Conta A com pendências, seguida de conta B, não mostra nem envia dados de A para B; callbacks atrasados não alteram B.
- Primeiro snapshot vazio de cache, Auth ainda restaurando ou permissão negada não sobrescreve a cópia local nem os dados remotos.
- Dois aparelhos editando, excluindo e finalizando offline convergem conforme os stamps e helpers existentes. Reset não ressuscita dados de geração antiga e conserva pendências antigas recuperáveis.
- Trocas kg/lb e retomadas de job de unidade não acumulam arredondamento indevido, convertem duas vezes nem confundem registros de unidades diferentes.
- Falha de quota, transação local abortada, arquivo Android incompleto e token inválido nunca produzem confirmação falsa.
- Android encerrado durante escrita recupera a última revisão válida; perda do armazenamento WebView não elimina o envelope em arquivo.
- Perfil total acima de 1 MiB sincroniza por documentos. Registro individual inválido permanece local e identificado; não há truncamento.
- Receber dados remotos conserva fotos e associações locais; bytes/URIs próprios não aparecem no Firestore.
- Migração interrompida mantém a origem íntegra e pode ser repetida. Nenhuma coleção do workout-tracker2 é alterada.
- Coach, provedores e chaves não ficam nos bundles ou rotas; nenhuma dependência direta nova além de `firebase` é introduzida.

Reaproveitar Vitest, os helpers e os cenários existentes de sync, adoption, signin-safety, tabs-owner, quota, unidades, reset, mídia e lançamento offline. Adaptadores injetáveis permitem simular rede, confirmação e falhas sem adicionar biblioteca. Verificar também IndexedDB real no navegador e o fluxo completo da UI.

Executar testes de regras em emulador com a ferramenta oficial disponível, sem acrescentar dependência de runtime ao app. Se o ambiente Android/emulador não estiver disponível, registrar a limitação e não declarar validação no dispositivo. Build web, build mobile e compilação do APK são verificações distintas.

## 10. Entregáveis e ativação

Entregar código e testes, configuração pública de ambiente documentada, regras específicas do namespace, scripts/build estático e mobile atualizados, instruções de uso offline e nota sobre os recursos do servidor antigo que saem desta versão.

Antes de instalar/implementar, esta especificação passa pela revisão do usuário e segue para um plano escrito com tarefas e verificações. Desenvolver em branch local isolada. Preparar a integração de forma revisável antes de qualquer ativação externa.

Esta aprovação de desenho não publica o site, muda regras implantadas, habilita faturamento, cria recursos Firebase ou executa migração em produção. A configuração externa necessária será apresentada concretamente quando os arquivos e testes estiverem prontos. Os dados do app antigo devem permanecer intactos durante todo o processo.
