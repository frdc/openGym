# React Offline + Firestore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adaptar o OpenGym React para treino offline durável e sincronização Firestore, removendo o Coach e mantendo poucas dependências.

**Architecture:** Preservar `S`, Zustand e os helpers de treino. Uma camada pequena de codec, armazenamento local e coordenação substitui o transporte Node. Estado e pendências são confirmados juntos localmente; transações remotas e uma revisão pequena do controle protegem merges que dependem do histórico.

**Tech Stack:** JavaScript/React 19, Zustand, Vite/Vitest existentes, IndexedDB nativo, Capacitor 7/Filesystem e módulos oficiais Firebase App/Auth/Firestore. Node 22, conforme o CI existente.

**Spec:** `docs/superpowers/specs/2026-10-07-react-offline-firestore-design.md`, aprovada pelo usuário em 7 de outubro de 2026.

## Global Constraints

- “O usuário escolheu React, web/PWA e Android via Capacitor.”
- “O desenho aprovado acrescenta apenas o pacote oficial `firebase` como dependência direta.”
- “Metadados de transporte, filas, identidade e tokens ficam fora dele e dos backups compartilháveis.”
- “Não escrever no documento `users/{uid}` nem nas coleções antigas `exercises`, `workouts`, `workoutSessions`, `medicines` ou `medicineLogs` diretamente abaixo dele.”
- “Fotos e vídeos próprios permanecem locais nesta versão.”
- “Lembretes e alarmes locais do Android continuam.”
- “As operações contêm somente os documentos afetados, nunca uma cópia inteira de `S` por alteração.”
- “O callback da transação pode executar mais de uma vez.”
- “Um documento individual acima do limite permanece recuperável localmente, com erro identificando o registro; não truncar séries nem histórico para conseguir sincronizar.”
- “Textos novos seguem o catálogo e a validação de todos os locales do projeto, incluindo português brasileiro.”
- Preservar AGPL e NOTICE. Não publicar, mudar regras implantadas, habilitar faturamento ou executar migração de produção durante esta implementação.

## Review Focus

- IDs com barras, Unicode ou nomes como `__proto__`: identidade estável e nenhuma mudança de caminho/protótipo; teste na tarefa 1.
- Envelope escrito por versão futura: conservar bytes e apresentar recuperação, sem sobrescrevê-lo; teste na tarefa 2.
- Snapshot que muda entre consulta e transação: refazer o contexto de merge, sem perder correção de PR ou avanço do plano; teste na tarefa 4.
- Mudança de conta enquanto uma gravação/consulta antiga termina: confirmação continua no proprietário original; testes nas tarefas 5 e 7.
- APK adaptado com botão de atualização do upstream: não oferecer download que substitui esta versão por outra arquitetura; verificação na tarefa 10.

---

## Ordem, ambiente e contratos compartilhados

Os caminhos abaixo são relativos à raiz do repositório. Comandos npm usam `C:\Repos\OpenGym\frontend` como diretório de trabalho. Todos os commits são locais na branch `codex/offline-firestore` ou na branch equivalente do checkout selecionado para execução.

A implementação começa somente após revisão deste plano e escolha de execução. A escolha de trabalhar na branch atual dispensa criar outra worktree. Antes de instalar, confirmar `git status`, branch e alterações do usuário. Não instalar dependências nem executar estes testes na etapa de escrever o plano.

Ambiente identificado: Node `22.14.0`, npm `11.8.0`, Java 20 no PATH e `adb` disponível. O projeto pede Java 21 em `docs/MOBILE.md`; localizar um JDK 21 já instalado antes de compilar o APK. Firebase CLI não foi localizado no PATH. Usar sua instalação disponível ou ferramenta oficial temporária com versão registrada para os emuladores, sem adicioná-la como dependência do app. Não alterar o Java global ou conectar emuladores ao projeto real para contornar problemas de ambiente.

Antes da tarefa 1: executar `npm ci --ignore-scripts`, `npm test` e `npm run build`; registrar a baseline. Se houver falha, distinguir problema de ambiente/regressão preexistente antes de atribuí-la à alteração. Ler as skills de execução/TDD/verificação e isolamento aplicáveis depois da aprovação do plano.

### Tipos JS/JSDoc e constantes

Definir os contratos em `frontend/src/lib/cloud/model.js`; não adicionar TypeScript:

```text
Owner = { projectId, uid: string|null, ownerKey }
ownerKey = JSON.stringify([projectId, 'apps/opengym', uid])
Control = { schemaVersion:1, generation, dataRevision, unitVersion,
            activeUnitJob:null|string, lastResetOpId:null|string }
Record = { schemaVersion:1, generation, unitVersion, dataUnit:null|'kg'|'lb',
           payload, stamps, deletedAt:null|number, appliedOpId:null|string }
Operation = { opId, ownerKey, generation, unitVersion, kind,
              paths, readPaths, payloads, blockedReason:null|string }
Envelope = { schemaVersion:1, ownerKey, localRevision, cloudGeneration,
             state, remoteMetadataByPath, pendingOperations, pendingJobs,
             adoptionDecision, recoveryCopies, lastConfirmedControl }
Confirmation = { ownerKey, opId, control, documents }
Profile = { control, documents } // documentos por caminho relativo
DomainContext = { remoteProfile:Profile, remoteState:S }
remoteMetadataByPath[path] = { record:Record, ackRevision:number }
Job = { jobId, ownerKey, generation, kind, options, totalParts, completedParts,
        status:'pending'|'running'|'complete'|'blocked' }
JobPart = { partId, paths, status, sourceVersion, targetVersion }
```

`dataRevision` é contador pequeno de consistência, não uma lista de mudanças. Toda transação que modifica documentos de domínio confirma sua revisão de base e avança esse contador. Isso permite obter contexto estável do histórico fora da transação e verificá-lo dentro dela, necessário para corrigir PRs e exercícios assistidos. Não usar `Math.max` genérico para mesclar `exWeights`.

Versão inicial `1`; namespace exato `users/{uid}/apps/opengym`; projeto de emulador `demo-opengym`; Auth em `127.0.0.1:9099` e Firestore em `127.0.0.1:8081`. Partes de job têm no máximo `20` IDs, reduzidas também por tamanho/orçamento de regras. Usar um limite conservador de payload serializado UTF-8 de `900 * 1024` bytes por documento, rejeitando estruturas que excedem a profundidade do Firestore; registrar `document-too-large`/`invalid-document` como bloqueio recuperável.

IDs já existentes permanecem. Novos IDs/opIds vêm de um gerador injetável que usa `crypto.randomUUID`; migração de treino sem ID usa identidade histórica + `sha256Hex` existente, calculada antes da transação. Codificar IDs arbitrários em base64url UTF-8; pesagem usa a data `d`, não `d|t`. Não interpolar UID/caminhos recebidos de outro proprietário.

## Task 1: Codec e operações determinísticas

**Files:** criar `frontend/src/lib/cloud/model.js`, `codec.js`, `codec.test.js`, `test-fixtures.js`; extrair `DEF` para `frontend/src/store/state-defaults.js` e reexportá-lo em `useStore.js`. Consultar `sync-merge.js`, `units.js`, `history.js`, `rotation.js`, `session-edit.js` e `exercises.js` existentes; `betterWeight`/`beatsWeight` estão em `exercises.js`.

**Interfaces:**
- `makeOwner(projectId, uid) -> Owner`; `makeEnvelope(owner, state) -> Envelope`.
- `FIELD_POLICY`: cada campo atual, opcional ou legado de `S` possui política sync/local/derived/legacy/removed.
- `encodeState(S, {ownerKey,generation,unitVersion}) -> {documents,localOverlay}`; `decodeState(documents,{defaults,localOverlay,generation,displayUnit}) -> S`.
- `prepareOperation(previous,next,{ownerKey,generation,unitVersion,kind,opId}) -> Operation|null`; `mergeOperation(remoteByPath,operation,{control,domainContext}) -> {documentsToWrite,confirmedDocuments}`.
- `mergeLocalDraft(currentEnvelope,{previous,next,operation}) -> Envelope`; `applyConfirmation(envelope,confirmation) -> Envelope`.
- Fixtures compartilhadas: `fixtureState(overrides={}) -> S`, `fixtureEnvelope(overrides={}) -> Envelope`. Criar apenas dados de teste, sem importar o store vivo.

- [ ] **Step 1 — Testes que falham:** em `codec.test.js`, cobrir roundtrip dos campos, identidade de pesagem corrigida, IDs especiais, stamps/tombstones, mídia/active excluídos, kg/lb sem arredondamento de serializer, PR assistido e correção histórica que reduz carga. Arranjar os estados com fixtures e helpers de domínio reais.

```js
expect(Object.keys(encodeState(S, options).documents)).toContain('bodyweight/2026-10-07')
expect(JSON.stringify(encodeState(S, options).documents)).not.toContain('file://private-photo')
expect(applyConfirmation(envelope, ack).pendingOperations.map(x => x.opId)).toEqual(['op-new'])
expect(Object.keys(DEF).filter(k => !(k in FIELD_POLICY))).toEqual([])
```

- [ ] **Step 2 — Confirmar RED:** `npm test -- src/lib/cloud/codec.test.js`; deve falhar pela ausência do módulo/contratos novos, não por fixture inválida.
- [ ] **Step 3 — Implementar:** mapear settings por campo, dias por chave e entidades da tabela da spec. Preservar `edited`, `undone`, `_f`, `_u` e exclusões por registro; não enviar `_rev/_wid/resetIds`, `coach`, URIs ou stamps de mídia. Obter paths do diff real. Merge usa contexto normalizado e helpers de domínio, sem efeitos/clock/IDs internos.
- [ ] **Step 4 — Confirmar GREEN:** rodar o teste novo e `npm test -- src/lib/sync-merge.test.js src/lib/units.test.js src/lib/rotation.test.js src/lib/session-edit.test.js`; não alterar arredondamento de domínio para ajustar o codec.
- [ ] **Step 5 — Commit:** `feat: add deterministic cloud state codec`.

## Task 2: Armazenamento durável, concorrência e migração

**Files:** criar `frontend/src/lib/cloud/offline-store.js`, `offline-idb.js`, `offline-fs.js`, `legacy-migration.js` e testes homônimos; adaptar leitura legada de `frontend/src/lib/mobile.js`. Consultar os testes existentes `media-store-idb.test.js`, `media-store-fs.test.js`, `useStore.tabs-owner.test.jsx`, `useStore.restore.test.jsx`.

**Interfaces:**
- `createIdbStorage({indexedDB,broadcast}) -> Storage`; `createFsStorage({loadFilesystem,hash}) -> Storage`; `createOfflineStorage({mobile,...deps}) -> Storage`.
- `Storage.open():Promise<void>`, `read(ownerKey):Promise<Envelope|null>`, `commit(ownerKey,reducer):Promise<Envelope>`, `flush(ownerKey):Promise<void>`, `subscribe(ownerKey,onRevision):unsubscribe`.
- `reducer(currentEnvelope)` é síncrono/puro; resolução de commit significa confirmação real. O backend incrementa `localRevision`, valida `ownerKey` e nunca confirma schema futura.
- `migrateLegacy({storage,legacyReader,owner,newId}):Promise<{envelope,recoveryCopies}>`; só copia legado identificado/decidido, mantendo origem.
- Acrescentar a `test-fixtures.js` um `fakeStorage(initial={})` com esse contrato, serialização, `failNextCommit(error)` e registro das revisões confirmadas. Fakes de IDB/FS exercitam falha/abort; comportamento real é verificado na tarefa 11.

- [ ] **Step 1 — Testes que falham:** estado+fila sobrevivem reload; dois commits simultâneos conservam ambos os treinos; abort não publica nova revisão; schema `2` não é sobrescrita; quota chega ao chamador; slot novo corrompido restaura anterior; contas têm diretórios diferentes; migração interrompida mantém origem.

```js
expect((await storage.read(owner.ownerKey)).pendingOperations.map(x => x.opId)).toEqual(['op-1'])
expect((await reader.read(owner.ownerKey)).state.workouts.map(x => x.id).sort()).toEqual(['a','b'])
await expect(storage.commit(owner.ownerKey, reducer)).rejects.toMatchObject({code:'storage-full'})
expect(await recovered.read(owner.ownerKey)).toMatchObject({localRevision:7})
```

- [ ] **Step 2 — Confirmar RED:** `npm test -- src/lib/cloud/offline-idb.test.js src/lib/cloud/offline-fs.test.js src/lib/cloud/legacy-migration.test.js`.
- [ ] **Step 3 — Implementar:** IDB lê/mescla a última revisão dentro da transação, sem await do reducer. FS grava envelope com checksum em dois slots por proprietário, relê/valida e serializa; sem debounce. A migração relê a cópia nova antes de marcar conclusão. Dados de Node com UID não comprovadamente Firebase ficam recuperáveis, não adotados automaticamente.
- [ ] **Step 4 — Confirmar GREEN:** os mesmos testes; também `npm test -- src/lib/media-store-idb.test.js src/lib/media-store-fs.test.js` após adaptar apenas fixture compartilhada se necessário.
- [ ] **Step 5 — Commit:** `feat: persist state and pending operations atomically`.

## Task 3: Firebase modular e sessão Auth

**Files:** criar `frontend/src/lib/cloud/firebase-client.js`, `auth-session.js` e testes; `frontend/.env.example`; modificar `.gitignore`, `frontend/package.json`, `frontend/package-lock.json`.

**Interfaces:**
- `readFirebaseConfig(env) -> {configured:boolean,options}`; `createFirebaseClient({config,emulator=false,sdk}) -> {app,auth,db}|null`.
- `createAuthSession({client,onUser,sdk}) -> {ready,login,register,resetPassword,signOut,stop}`; `ready:Promise<User|null>`, operações async e `stop():void`. Primeiro callback válido resolve ready; uma consulta síncrona inicial nula não provoca saída.
- `User` tem `uid`, `email`, `displayName`; adapter do store mantém o alias `user.id = uid` para consumidores atuais.

- [ ] **Step 1 — Testes que falham:** config ausente conserva modo local; listener atrasado não é logout; restauração offline conserva proprietário; SDK erro de provedor/cadastro/senha é exposto; import modular; emuladores não podem usar o projectId real.

```js
expect(readFirebaseConfig({}).configured).toBe(false)
expect(onUser).not.toHaveBeenCalled() // antes do primeiro callback de Auth
expect(restoredUser.uid).toBe(uidA)
expect(clientOptions.options.projectId).toBe('demo-opengym')
```

- [ ] **Step 2 — Confirmar RED:** `npm test -- src/lib/cloud/firebase-client.test.js src/lib/cloud/auth-session.test.js`.
- [ ] **Step 3 — Implementar/instalar:** consultar a versão estável oficial de `firebase` no registry, validar semver e instalar com versão exata/lockfile, sem scripts desnecessários. Usar App/Auth/Firestore modular e persistência Auth oficial; guardar tokens somente no mecanismo do SDK. Exemplo contém nomes `VITE_FIREBASE_API_KEY`, `AUTH_DOMAIN`, `PROJECT_ID`, `APP_ID` com prefixo `VITE_FIREBASE_`; `.env.local` fica ignorado. Emulador só em desenvolvimento e projeto `demo-opengym`.
- [ ] **Step 4 — Confirmar GREEN:** testes acima + `npm run build`; revisar `npm audit --omit=dev` e lockfile, separando avisos preexistentes. Não substituir pacotes por alternativas especulativas nem atualizar toda a árvore sem motivo.
- [ ] **Step 5 — Commit:** `feat: add modular Firebase authentication`.

## Task 4: Transporte Firestore e regras do namespace

**Files:** criar `frontend/src/lib/cloud/firestore-port.js`, `firestore-port.test.js`; `firebase/opengym.rules`, `firebase/emulator.json`; `frontend/scripts/check-firestore-rules.mjs`; script `test:firestore` no package frontend.

**Interfaces:**
- `createFirestorePort({client,codec,sdk}) -> Remote`.
- `readProfileFromServer(owner):Promise<Profile>`; `watchControl(owner,onControl,onError):unsubscribe`; `commitOperation(owner,operation,{expectedControl,domainContext}):Promise<Confirmation>`.
- `commitReset(owner,{opId,baseGeneration,nextGeneration}):Promise<Control>`; primitives de jobs/limpeza são acrescentadas na tarefa 6.
- Acrescentar `fakeRemote(profile)` aos fixtures: mesmo contrato, transações registradas, controle de erro/repetição/callback atrasado e revisão/generation. Não usar esse fake como prova de regras; o script emulador usa o SDK real.

- [ ] **Step 1 — Testes que falham:** leitura sem servidor não inicializa perfil; query que muda durante leitura exige nova tentativa; transação com `dataRevision` diferente produz `refresh-required`; treino/progressão/plano são um commit; replay estável não duplica treino; nenhuma escrita passa por coleções legadas.

```js
await expect(remote.commitOperation(owner, op, staleContext)).rejects.toMatchObject({code:'refresh-required'})
expect(writtenPaths).toEqual(expect.arrayContaining(['workouts/w1','plans/main']))
expect(allAbsolutePaths.every(p => p.startsWith(`users/${uidA}/apps/opengym`))).toBe(true)
```

- [ ] **Step 2 — Confirmar RED:** `npm test -- src/lib/cloud/firestore-port.test.js`.
- [ ] **Step 3 — Implementar:** obter controle antes/depois das consultas paginadas da geração ativa; aceitar o contexto somente com generation/dataRevision iguais. Na transação, ler controle e documentos afetados antes de escrever, conferir a revisão e executar merge puro; atualizar contador quando há mudanças. Cache de contexto confirmado evita consulta completa para callback da própria confirmação; mudança de outro aparelho exige contexto estável novo.
- [ ] **Step 4 — Regras/emulador:** namespace é allowlist; proprietário, schema, generation e formato validados, escrita de domínio exige revisão de controle coerente via `getAfter`. Auth+Firestore em `demo-opengym`; teste cria usuários A/B via Auth emulado com SDK já instalado e testa sem sessão, acesso cruzado, generation antiga, controle inválido e doc excessivo. Usar Node fetch/SDK, sem `firebase-admin`/biblioteca extra de regras. Emulador isolado não contém as regras de produção legadas; documentar que seu fragmento precisa ser reconciliado com as regras reais antes da ativação.
- [ ] **Step 5 — Confirmar GREEN:** teste unitário e `firebase emulators:exec --project demo-opengym --config firebase/emulator.json --only auth,firestore "npm --prefix frontend run test:firestore"`, executado da raiz com CLI oficial disponível/temporária. Regras testadas permitem só o esperado; comportamento de contenção real do Firestore não é certificado pelo emulador.
- [ ] **Step 6 — Commit:** `feat: sync isolated Firestore documents with validated rules`.

## Task 5: Coordenador de sync, confirmações e identidade

**Files:** criar `frontend/src/lib/cloud/sync-bridge.js`, `sync-status.js`, testes homônimos. Consumir interfaces das tarefas 1–4.

**Interfaces:**
- `createSyncBridge({storage,codec,remote,clock,newId,onState,onStatus}) -> Bridge`.
- `hydrate(owner):Promise<void>`, `bindAuth({owner,user,authEpoch}):Promise<void>`, `unbindAuth():Promise<void>`.
- `recordChange({previous,next,kind='edit',scheduleRemote=true}):Promise<Envelope>`, `flushLocal():Promise<void>`, `syncNow():Promise<void>`, `resolveAdoption('add'|'keep'):Promise<void>`, `readRemote():Promise<Profile>`.
- `getUnsynced():{count,blocked}`, `subscribeStatus(listener):unsubscribe`; estados de gravação e sync separados, incluindo erro com `code` e registro associado.

- [ ] **Step 1 — Testes que falham:** alteração offline/reload/reconexão; nova operação durante upload; conta trocada durante resposta; invalidar authEpoch antigo; snapshot vazio de cache; adoção pendente após reload; `keep` conserva cópia local recuperável; rede/token/quota não apagam pendências.

```js
expect(storageSnapshot.pendingOperations.map(x => x.opId)).toEqual(['op-new'])
expect(sentOperations.every(x => x.ownerKey === ownerA.ownerKey)).toBe(true)
expect(onStateForB).not.toHaveBeenCalledWith(expect.objectContaining({ownerKey:ownerA.ownerKey}))
expect(remoteCommitsBeforeAdoption).toHaveLength(0)
```

- [ ] **Step 2 — Confirmar RED:** `npm test -- src/lib/cloud/sync-bridge.test.js src/lib/cloud/sync-status.test.js`.
- [ ] **Step 3 — Implementar:** hidratação local independente de nuvem; captura imutável de owner/epoch; commit local usa `mergeLocalDraft`; envio transacional usa Profile estável; confirmação aplica somente opId recebido no envelope daquele proprietário. Rebase de generation nula só após primeira inicialização servidor confirmada; jamais reatribuir generation antiga após reset.
- [ ] **Step 4 — Retomada/status:** coalescer apenas edits seguros; intervalos de retry `1,2,4,8,16,30` segundos, teto `30`; erros permanentes ficam bloqueados até ação/correção, sem loop. Foreground/online/sync manual reiniciam tentativas. Supressão do banner não apaga erro/indicador Home.
- [ ] **Step 5 — Confirmar GREEN:** testes novos + suite `src/lib/cloud`; testar dois bridges/fakes compartilhando a mesma conta, inclusive callback depois de `unbindAuth`.
- [ ] **Step 6 — Commit:** `feat: coordinate durable offline synchronization`.

## Task 6: Reset e jobs retomáveis de importação/unidade

**Files:** criar `frontend/src/lib/cloud/sync-jobs.js`, `sync-jobs.test.js`; ampliar `firestore-port.js`, `sync-bridge.js`, regras e teste emulador.

**Interfaces:**
- `createJob({ownerKey,generation,kind,opId,paths,options}) -> Job` com partes de até 20 IDs; `planUnitJob({profile,to,convert,opId}) -> Job`.
- `Remote.beginJob(owner,job):Promise<void>`, `commitJobPart(owner,job,part):Promise<Confirmation>`, `finishJob(owner,job):Promise<Control>`, `deleteOldGeneration(owner,{generation,paths}):Promise<void>`; documentos de partes estão em `jobs/{jobId}/parts/{partId}`.
- Acrescentar a Bridge `reset():Promise<void>`, `importBackup(backup,{mode:'merge'|'replace',mergeWith=null}):Promise<void>`, `changeUnit(to,{convert=true}={}):Promise<void>`.

- [ ] **Step 1 — Testes que falham:** reset repetido encontra nextGeneration sem criar outra; reset concorrente não sobrescreve outra geração; cleanup não apaga ID recriado; importação interrompida não duplica; manifest não embute lista crescente; transformação marcada junto dos pesos; fila antiga normaliza versões intermediárias uma vez.

```js
expect(controlAfterSecondReset.generation).toBe(reset.nextGeneration)
expect(recreatedDocument.generation).toBe('new-generation')
expect(parts.every(p => p.paths.length <= 20)).toBe(true)
expect(secondAttempt.transformedEntities).toHaveLength(0)
```

- [ ] **Step 2 — Confirmar RED:** `npm test -- src/lib/cloud/sync-jobs.test.js`.
- [ ] **Step 3 — Implementar reset/import:** persistir `{opId,baseGeneration,nextGeneration}` antes do envio; reconhecer replay na transação. Stale generation vai para recoveryCopies daquele owner. Cleanup compara generation em cada exclusão transacional. Import replace informa conflitos atuais; operações novas observadas durante a prévia são reconciliadas, não apagadas sem confirmação. Fonte de backup e payloads incompletos permanecem locais até concluir partes.
- [ ] **Step 4 — Implementar unidade:** preservar conversão normal de domínio e usar codec sem deriva. Relabel sem conversão usa job com origem/destino/modo; controlar versão por entidade e marker no mesmo commit. Pausar uploads numéricos durante job, retomar por outro aparelho e normalizar pendências antigas pela cadeia de jobs. `plates` não é convertido; valores por unidade continuam separados.
- [ ] **Step 5 — Confirmar GREEN:** testes novos, os de port/bridge e script emulador cobrindo job ativo, versão incorreta, replay e exclusão condicional. Arrays grandes passam como partes; registro inválido permanece bloqueado sem truncamento.
- [ ] **Step 6 — Commit:** `feat: resume profile resets imports and unit migrations`.

## Task 7: Conectar a camada nova ao store e ao treino

**Files:** modificar `frontend/src/store/useStore.js`, `frontend/src/sheets.jsx` finalização em 2851–2899, `frontend/src/lib/mobile.js`; criar `frontend/src/store/useStore.cloud.test.jsx`; adaptar testes `useStore.sync`, `adopt`, `adopt-hold`, `signin-safety`, `hold-signout`, `tabs-owner`, `quota`, `clock`, `unit-sync`, `reset-sync`, `import-check`, `import-restore`, `restore`, `kept-copy` (todos `.test.jsx`).

**Interfaces:** preservar chamadas `update(mut,push=true)`, acrescentando terceiro argumento opcional `{kind='edit'}` para identificar finalização/edição histórica. Preservar retornos síncronos de `saveHistoryEdit()`/`deleteHistoryEdit()`, `boot()`, `pushState()`, `pullState()`, `syncNow()`, `unsyncedChanges()`, adoção/import/reset/unidade e backup usados pela UI. Acrescentar `flushLocal():Promise<void>` e `localReady`/`authReady`; `ready` libera UI só após hidratação local segura. `push=false` suprime tentativa imediata, sem mudar classificação do campo.

- [ ] **Step 1 — Testes que falham:** producer executa uma vez; treino finalizado gera operação com todos os docs efetivamente alterados; edição histórica conserva PR corrigido; treino ativo não vai à nuvem; UID B não herda A; arquivo Android sobrevive perda de WebView storage; callback de boot tardio não substitui edição atual.

```js
expect(producer).toHaveBeenCalledTimes(1)
expect(operation.paths).toEqual(expect.arrayContaining(['workouts/w1','plans/main']))
expect(store.getState().S.active).toEqual(activeDraft)
expect(storeB.getState().S.workouts).not.toContainEqual(expect.objectContaining({id:'from-A'}))
```

- [ ] **Step 2 — Confirmar RED:** `npm test -- src/store/useStore.cloud.test.jsx`.
- [ ] **Step 3 — Implementar store:** substituir `loadState/persist`, HTTP/revisões/pairing e mirror por bridge; manter ações de domínio e `stampChange`. Executar producer uma vez, mostrar estado de gravação e salvar async. Wrappers esperam `flushLocal` nos pontos de finalização/saída/background; resumir falha no componente de status, sem falso sucesso de persistência.
- [ ] **Step 4 — Adaptar cenários:** migrar asserts de `/api` para semântica do storage/Remote, sem simplesmente apagar cobertura de regressões. `setUser` só confirma proprietário via Auth; stashes/recovery permanecem por owner/generation. Treino ativo e overlay local são carregados junto do envelope, sem esperar download.
- [ ] **Step 5 — Confirmar GREEN:** `npm test -- src/store src/lib/finish-workout.test.js src/lib/session-edit.test.js src/lib/progression.test.js src/lib/history.test.js src/lib/rotation.test.js src/lib/onerm.test.js`; depois suite completa para detectar consumidores de métodos retirados.
- [ ] **Step 6 — Commit:** `feat: connect workout state to offline Firestore persistence`.

## Task 8: Conta Firebase, status e retirada de Coach/UI servidor

**Files:** modificar `frontend/src/App.jsx`, `views/Login.jsx`, `views/MobileOnboarding.jsx`, `views/Settings.jsx`, `views/settings-pages.js`, `views/Plan.jsx`, `components/PasswordAuth.jsx`, `components/ServerSync.jsx`, `components/SyncBanner.jsx`, `lib/guest.js`, `lib/default-lang.js`, `store/useUI.js`, `views/Workout.jsx`, `frontend/public/sw.js`, `frontend/src/locales/*.js`; retirar `views/CoachChat.jsx`, `CoachIntake.jsx`, `CoachSetup.jsx`, `AdminCoach.jsx`, `Admin.jsx` e seus imports/CSS/testes exclusivos. Paths abreviados de views/components/lib/store estão sob `frontend/src`.

**Interfaces:** `PasswordAuth` usa AuthSession; `connectionView(sync,{online})`/`actionLabel(view)` continuam compartilhados pelo status; ações são login, retry e revisão de pendências. Onboarding oferece local ou conta Firebase. Retirar passkeys, pairing, convites, config/admin/atividade HTTP e Web Push; preservar RestAlert/timers e notificações Android.

- [ ] **Step 1 — Testes que falham:** Login email/senha/cadastro/recuperação, modo local sem config, adoção explícita, gravação em andamento/erro, indicador Home quando banner oculto; nenhuma rota/menu Coach/Admin; reminder Android ainda agenda; nenhum request de push/atividade no navegador.

```js
expect(routes).not.toContain('/coach')
expect(accountButtons).toEqual(expect.arrayContaining(['Sign in','Create account']))
expect(fetchRequests.some(x => x.url.includes('/api/'))).toBe(false)
expect(syncViewForFailedLocalWrite.tone).toBe('bad')
```

- [ ] **Step 2 — Confirmar RED:** adaptar/criar `Login.firebase.test.jsx`, `MobileOnboarding.firebase.test.jsx`, `Settings.firebase.test.jsx`, `SyncBanner.firestore.test.jsx` e executar esses arquivos. Preservar cenários de testes atuais que ainda representam recursos presentes.
- [ ] **Step 3 — Implementar telas/cleanup:** retirar também `/coach/intake`, `/coach/setup`, `/coach/proposal`, device-link e callbacks antigos. Fila/rotação antiga continua válida com texto de plano, sem menu de IA. SDK errors são traduzidos sem expor token. Copiar strings novas em todos os packs conforme regras existentes, preservando herança pt-BR.
- [ ] **Step 4 — Confirmar GREEN:** testes acima, `npm test -- src/views src/components src/store/useUI.work-reload.test.js src/store/useUI.rest-reload.test.js`, `node scripts/check-locales.mjs`, `node scripts/check-source-strings.mjs`. SW preserva caches/chunks/offline; handlers de push e subscrição saem.
- [ ] **Step 5 — Commit:** `feat: replace server account flows and remove Coach UI`.

## Task 9: Mídia local isolada por proprietário

**Files:** modificar `frontend/src/main.jsx`, `lib/media-store.js`, `media-store-idb.js`, `media-store-fs.js`, `backup-media.js`, `components/CustomMedia.jsx`, `CustomMediaField.jsx`, `WorkoutMedia.jsx`, `views/ProgressPhotos.jsx`, `views/Settings.jsx`, `sheets.jsx`; substituir `lib/media-sync.js` por `lib/local-media.js`; retirar `media-owed.js` quando seus consumidores forem migrados.

**Interfaces:** `getMediaStore(ownerKey)` seleciona armazenamento/índice daquele perfil; `startLocalMedia({appStore,getOwner}) -> unsubscribe`, `localMediaGc(ownerKey):Promise<void>` preservam limpeza local. Mídia antiga vira overlay recuperável do owner correto. Bytes deduplicados não autorizam associação/listagem para outro UID.

- [ ] **Step 1 — Testes que falham:** foto continua após refresh remoto/reload; B não lista/abre associação de A; arquivo referenciado não é coletado; foto local não conta como upload pendente; ZIP inclui apenas bytes locais e informa ausência; GC de slot antigo não apaga arquivo usado pelo owner ativo.

```js
expect(await mediaB.has(hashFromA)).toBe(false)
expect(remoteOperationForMediaOnly).toBeNull()
expect(await mediaA.has(referencedHash)).toBe(true)
expect(unsyncedAfterLocalPhoto.count).toBe(0)
```

- [ ] **Step 2 — Confirmar RED:** adaptar `media-store.test.js`, `media-store-idb.test.js`, `media-store-fs.test.js`, `backup-media.test.js` e criar `local-media.test.js`; `npm test -- src/lib/local-media.test.js`.
- [ ] **Step 3 — Implementar:** manter ingest/sniff/refs/limites locais e salvar com `pending:false` para nuvem inexistente. Extrair GC antes de retirar downloads/uploads, `fetchToStore/mayFetch/settleMedia`. Preservar overlays locais ao decodificar docs. Retirar as mensagens de quota/sweep do servidor sem perder erros de storage local.
- [ ] **Step 4 — Confirmar GREEN:** `npm test -- src/lib/media-store.test.js src/lib/media-store-idb.test.js src/lib/media-store-fs.test.js src/lib/backup-media.test.js src/lib/local-media.test.js src/lib/workout-media.test.js src/sheets.workout-media.test.jsx`; suíte completa identifica consumidores restantes.
- [ ] **Step 5 — Commit:** `feat: preserve account-scoped local workout media`.

## Task 10: Artefatos estáticos/Android e dependências finais

**Files:** `frontend/package.json`/lock, `frontend/vite.config.js`, novo `frontend/scripts/build-mobile.mjs`, `check-mobile-bundle.mjs`, novo `check-cloud-bundle.mjs`; `web/Dockerfile`, `web/nginx.conf.template`, `docker-compose.yml`, `.github/workflows/test.yml`, `docker-publish.yml`, `pages.yml`, `mirror.yml`, `.gitlab-ci.yml`, `.github/dependabot.yml`, README/CLAUDE/CONTRIBUTING/docs afetados. Retirar código Coach em `frontend/src/lib/coach*.js`, CSS, scripts `build-coach-assets.mjs`, `build-coach-library.mjs`, gerador API e pacotes API/MCP que deixam de pertencer aos artefatos desta adaptação. Não remover helpers puros compartilhados usados pelos treinos.

**Interfaces:** `npm run build:mobile` passa a chamar runner Node multiplataforma; preservar `VITE_MOBILE=1`, os URLs de catálogo atuais, stamp do SW, cap sync e check final. `npm run check:cloud-bundle` valida bundles/config/deps e ausência de imports/runtime Coach/API antigo. Atualização automática upstream é retirada da UI/`lib/update.js` enquanto não houver canal da versão adaptada; licença/atribuição upstream permanecem.

- [ ] **Step 1 — Testes que falham:** build mobile executa em Windows sem atribuição POSIX de env; SW tem todos os lazy chunks; manifest tem Firebase e não secure-storage/SDKs IA; build web não precisa de api/coach; não há URL de download upstream em ação de atualização do APK.

```js
expect(packageJson.dependencies.firebase).toMatch(/^\d+\.\d+\.\d+$/)
expect(packageJson.dependencies['@aparajita/capacitor-secure-storage']).toBeUndefined()
expect(mobileSpawn.env.VITE_MOBILE).toBe('1')
expect(updateDownloadTargets).toEqual([])
```

- [ ] **Step 2 — Confirmar RED:** criar teste do runner (`scripts/build-mobile.test.mjs`) e checker; executar `node --test scripts/build-mobile.test.mjs` e check em fixture de bundle antigo.
- [ ] **Step 3 — Implementar:** runner usa Node spawn/env explícito, preservando código de saída. Remover proxy `/api` e cópia do Coach do Docker; servidor estático continua oferecendo catálogo. Remover dependências/matrizes/jobs da API/Coach/MCP dos artefatos novos e manter frontend/locales/Android. CI e mirror não publicam upstream/GitLab automaticamente a partir desta execução local; ajustar/desabilitar o mirror herdado no fork. Atualizar docs sobre dados locais, Firebase, mídia e recursos retirados.
- [ ] **Step 4 — Confirmar GREEN:** `npm run build`, `npm run build:mobile`, `npm run check:cloud-bundle`, testes dos scripts, `node scripts/check-mobile-bundle.mjs`. Revisar diff/lockfile: único acréscimo direto é Firebase, nenhum secret/token/payload pessoal foi versionado. Compile APK com JDK21 e `./gradlew.bat assembleDebug` em `frontend/android`; confirmar saída separadamente de cap sync.
- [ ] **Step 5 — Commit:** `build: ship static Firebase web and Android artifacts`.

## Task 11: Verificação completa e entrega revisável

**Files:** criar `docs/dev/OFFLINE_FIRESTORE_VERIFICATION.md`, atualizar `docs/MOBILE.md`, `docs/README.md` e instrução de integração das regras `firebase/README.md`; corrigir apenas falhas reproduzidas descobertas na verificação.

**Interfaces:** documentação contém resultado observado, comando/ambiente, limitações e hash do commit. Não registrar credenciais, dados reais nem resultados esperados como resultados obtidos. Preparar fragmento de regras e configuração para revisão antes de ativar o Firebase real.

- [ ] **Step 1 — Suites/builds:** `npm test`, `npm run test:fatigue-probe`, checks locales/source, `npm run build`, check bundle cloud, build mobile/check bundle e emuladores de Auth/Firestore. Só repetir/broadenar quando houver alteração ou falha relevante.
- [ ] **Step 2 — Navegador real:** abrir PWA com projeto demo e IndexedDB real; criar rotina, iniciar/finalizar treino offline, fechar/reabrir, reconectar e verificar outro contexto/aparelho emulado da mesma conta. Abrir duas abas e editar; conferir PR/rotação, backup e foto local. Rodar bloqueio de rede, abort/quota simulada e troca A→B; nova confirmação não mistura contas.
- [ ] **Step 3 — Android:** com emulador ou dispositivo de teste autorizado, testar encerramento antes/depois da confirmação, perda do storage WebView, restauração pelos slots, airplane mode/reabertura, sync com PWA e lembrete/rest alarm. Registrar package/versão debug e dispositivo. Sem ambiente disponível, entregar APK e declarar testes de dispositivo pendentes, sem afirmar aprovação.
- [ ] **Step 4 — Revisão:** revisar branch inteira contra a spec e solicitar review independente conforme método escolhido. Resolver achados materiais, repetir somente verificações afetadas. Inspecionar trechos de rules/config e preservação das coleções legadas; nenhuma implantação real é necessária para aceitar a implementação local.
- [ ] **Step 5 — Entrega:** commit `docs: record offline Firestore verification`; apresentar arquivos/artefatos, mudanças, evidência e limites. PR draft só quando autorizado/necessário à forma de entrega escolhida; se criado, anexar ao chat. Publicação, regras reais, provedor Auth/faturamento e migração de dados reais ficam para revisão concreta posterior.

## Método de execução e sequência

Dependências: 1 → 2; 3 pode ser implementada após 1 sem alterar seus arquivos; 4 usa 1+3; 5 usa 1–4; 6 usa 4+5; 7 usa 1–6; 8 e 9 usam 7 e compartilham Settings/sheets, portanto suas edições precisam ser sequenciais; 10 fecha imports/manifests; 11 valida tudo.

Recomendação: execução com subagentes e revisão por tarefa, porque falhas de persistência, confirmação e identidade podem perder ou misturar histórico. Cada tarefa produz um commit revisável; um revisor recebe a spec e o foco de risco da tarefa. Não implementar tarefas que ainda consomem interfaces indefinidas nem paralelizar alterações nos mesmos arquivos.

Alternativa: execução direta nesta sessão, mantendo o mesmo plano/testes/commits e uma revisão independente da branch no final. Em ambas, trabalhar na branch local atual é suficiente para esta cópia dedicada; criar worktree apenas se o usuário escolher esse isolamento.

## Referências de verificação

- [Emulador Firestore e projetos demo](https://firebase.google.com/docs/emulator-suite/connect_firestore): projetos `demo-` não possuem recursos reais; o emulador não reproduz toda a contenção de transações de produção.
- [Configuração da suíte de emuladores](https://firebase.google.com/docs/emulator-suite/install_and_configure): usar apenas Auth/Firestore locais e uma identidade de projeto consistente.
- `docs/MOBILE.md`: requisito Java 21; Node 22 está definido no CI/Docker existentes.

## Revisão do plano

Mapeamento da spec: escopo/dependências → 1,3,8,10; persistência/migração → 2,7; esquema/regras → 1,4; sync/conflitos → 4,5,7; unidade/reset/import → 6; Auth/privacidade → 3,5,7,8; mídia/status/locale → 8,9; aceitação/ativação → 11. Os cinco itens de Review Focus possuem testes nas tarefas indicadas. Interfaces e nomes compartilhados foram conferidos; este documento é plano, não evidência de testes executados.
