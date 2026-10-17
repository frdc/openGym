# Mobile build

Android uses Capacitor 7.6.9, Java 21, Gradle 8.11.1 and compile/target SDK 35. Node 22 builds the web assets. From `frontend`:

```sh
npm ci
npm run build:mobile
npm run check:cloud-bundle
```

The cross-platform Node runner sets `VITE_MOBILE=1`, preserves the pinned jsDelivr catalogue image/video URLs, builds/stamps the service worker, runs `cap sync android` and verifies every output byte against the Android public asset copy. All emitted JS/CSS lazy packs must be in the service-worker list. This command does not compile an APK.

Set `JAVA_HOME` to a JDK 21 installation and `ANDROID_HOME` to an SDK containing platform 35 in the current shell only. Then run from `frontend/android`:

```sh
./gradlew --no-daemon assembleDebug
```

Windows uses `./gradlew.bat --no-daemon assembleDebug`. The output is `app/build/outputs/apk/debug/app-debug.apk`. Debug keeps applicationId `com.fredc.opengym.test` and x86_64 support; release retains ARM filters. FileProvider and cache paths remain for Share. The updater-only Install plugin and install-packages permission are removed. Do not distribute a debug APK as a signed release.

Local native two-slot archives are owner-separated and readback-verified. WebView eviction does not make localStorage the authority. Failed disk writes remain errors; only confirmed durable bytes can survive immediate process loss. Own photos/videos remain local. Local reminders/rest alarms and opaque session/timer guards are retained.

Firebase public configuration is compiled at build time as documented in README.md. Ordinary local builds need no production config. No production setup, accounts, rules, billing or migration is performed by these commands. Actual demo-project Auth/Firestore QA and physical device/offline checks are separate. Release mixed-content settings remain strict; no shared debug transport relaxation is introduced.

## iOS policy

The iOS source shell is retained with the obsolete vault pod removed. `build:mobile` intentionally syncs Android only, so Windows does not imply fresh iOS assets or CocoaPods success. To validate iOS on macOS, build mobile assets with the runner, explicitly run `npx cap sync ios`, then `node scripts/check-mobile-bundle.mjs --ios`, followed by a separate Xcode build/device check. Never ship an existing iOS public directory without that fresh sync. No iOS QA is claimed here.

## Wear OS

### Tipos de peso salvos e fundo vivo (13/10/2026)

Na tela do exercício e nas configurações, **Tipo de peso** permite escolher perfis salvos ou criar um novo. Cada perfil tem nome, unidade, carga inicial e incremento. Há exemplos prontos de 5 em 5 kg, 5,3 em 5,3 kg e Movement (11,8 kg iniciais, passo de 6,8 kg); todos podem ser editados ou excluídos em **Perfis de carga salvos**. Um exercício usa uma cópia do perfil escolhido: alterações posteriores no cadastro não reescrevem o treino ou histórico. Séries concluídas e cargas já digitadas são preservadas ao selecionar um perfil; séries vazias recebem a carga inicial.

Os perfis ficam no estado da conta, com gravação local confirmada antes de fechar o formulário e mesclagem por perfil na sincronização. Mantêm a unidade em que foram cadastrados. Trocar kg/lb preserva a posição da pilha; os planos compartilhados levam a configuração selecionada. A progressão, a redução de carga, os aquecimentos e os controles do relógio usam a grade disponível. O editor do relógio invalida um rascunho aberto caso o perfil de carga mude no celular.

O relógio usa um fundo nativo em gradiente azul/verde/violeta com brilho e movimento suave. A animação respeita a configuração de animações do sistema, para ao sair do primeiro plano e fica desativada no modo ambiente, que mantém o fundo preto. **Iniciar** e **Concluir** usam o mesmo arredondamento e altura de 48 dp.

Verificação: suíte completa com 354 arquivos/3.876 testes passando; após o ajuste final do resumo de recuperação de perfis, mais 91 testes focados passaram. Os 17 testes unitários e 19 testes de interface/serviços do relógio passaram, incluindo início de carga em 11,8 kg e invalidação de rascunho quando o perfil muda. Traduções (17 packs/2.031 chaves), scripts de build e pacote cloud passaram. O fluxo de seleção/criação foi verificado no navegador local, inclusive 11,8 → 18,6 kg e persistência após recarregar. Builds mobile e nativos com Java 21 concluídos. APKs instalados apenas no emulador do relógio; a instalação nos aparelhos físicos continua pendente.

APKs finais: `frontend/android/app/build/outputs/apk/debug/app-debug.apk`, SHA256 `ea24d79c3bea24eaf564004d5d14653264a5c3fc9231c0b8bab5fa5a76d0204b`; `frontend/android/wear/build/outputs/apk/debug/wear-debug.apk`, SHA256 `e9925e72ff8df8ab33333fc6321062c893802fb4ac21f98dae86f2cd06692c4e`.

### Ajustes de início, batimentos e cargas (13/10/2026)

Na tela principal, **Iniciar** dá acesso à ativação opcional dos batimentos sem entrar nas opções. Na primeira ativação, confirme o consentimento e a permissão de sensores; aguarde uma leitura válida e toque em **Iniciar série** antes da primeira repetição. O botão fica indisponível enquanto o sensor não fornece uma leitura recente. **Concluir** continua disponível para registrar séries sem sensores quando a coleta está desligada. Durante o descanso, o botão com o ícone de iniciar permite marcar a próxima série sem esperar o timer terminar.

O valor atual em bpm permanece na tela principal durante esforço e recuperação. Uma leitura com mais de 15 segundos é substituída por um traço; dados antigos nunca são apresentados como uma medição atual. A coleta e os registros de recuperação continuam usando o serviço e a fila persistente existentes.

Nas configurações do exercício, o incremento de carga está disponível mesmo com a progressão automática desligada. Para uma máquina com os valores 11,8, 18,6, 25,4 kg, configure a carga inicial de 11,8 kg e o passo de 6,8 kg. O incremento é próprio do exercício e também é enviado ao editor de carga do relógio.

A proteção nativa do treino em segundo plano e os bloqueios breves de CPU para comandos estão incluídos no APK do celular. Os dois testes `WearPhoneBackgroundTest` passaram em um emulador Android 36 separado: proteção enquanto o treino está ativo, remoção ao encerrar, entrega ao JavaScript com a tela apagada e liberação da CPU após a resposta. Essa validação usa callbacks nativos de teste, sem um par físico celular/relógio; a confirmação da conexão real com o celular bloqueado continua pendente. Os novos APKs foram instalados apenas em emuladores.

Verificação final: 181 testes JavaScript focados, 6 testes dos scripts de build, 22 testes unitários nativos, 9 testes de interface do relógio e 2 testes de segundo plano do celular passaram. Traduções, build mobile e verificação do pacote cloud passaram. As capturas reais do emulador foram inspecionadas para início, conclusão e descanso. APKs debug: `app/build/outputs/apk/debug/app-debug.apk` (SHA256 `a25e117b259c995ad7466619d9366d5d26742225507730bbb221e34c835adb5b`) e `wear/build/outputs/apk/debug/wear-debug.apk` (SHA256 `2e6610b3d8625b9fd377471805493c11d4ba234465b4f8484d53ae2db7d35d5b`), ambos em `frontend/android`.

O módulo `wear` gera um APK acompanhante para Galaxy Watch Ultra/Wear OS. Ele mostra exercício/série, permite editar carga/repetições e controla conclusão e descanso; o app Android continua responsável por salvar e finalizar o treino. A coleta opcional de frequência cardíaca registra esforço e recuperação por série. Compilar com `gradlew.bat --no-daemon :app:assembleDebug :wear:assembleDebug`. Os dois APKs debug usam `com.fredc.opengym.test` e devem ser assinados pelo mesmo certificado. Ver [instalação e checklist inicial](dev/WEAR_OS_VERIFICATION.md) e [frequência cardíaca e limitações](dev/WEAR_HEART_RATE_VERIFICATION.md). Os relatórios históricos preservam os identificadores usados na época.

Durante um treino ativo, uma notificação persistente mantém o processo Android disponível para os controles do relógio com a tela do celular apagada. Cada pedido recebido mantém apenas a CPU acordada até terminar a resposta, com limite de dez segundos; não mantém a tela ligada. Encerrar o treino ou destruir a ponte remove essa proteção. Encerrar o processo à força ainda exige reabrir o app: o serviço não recria uma sessão de treino.

No relógio, a interface usa superfícies arredondadas inspiradas no Material 3: ações principais em âmbar, descanso em verde-sálvia e botões secundários em oliva sobre fundo escuro. Ícones vetoriais indicam iniciar/retomar, pausar e concluir; controles indisponíveis usam cores atenuadas. A conexão normal não ocupa uma linha de texto: uma bolinha vermelha no cabeçalho aparece quando o celular está desconectado ou sem responder. A espera pela confirmação aparece no próprio botão. Durante o descanso, o botão grande com o tempo restante pausa/retoma; +15 s, pular e editar carga/repetições ficam na tela principal. As opções separam Batimentos e Alertas, com Reconectar visível apenas quando necessário. Os controles têm alvos de toque de pelo menos 48 dp. Uma ação sem confirmação continua exigindo conferência no celular antes de repetir, mesmo após reconectar.

Verificações de tela apagada: `WearPhoneBackgroundTest` exercita a entrega ao JavaScript, a liberação da CPU após falha de resposta e o ciclo de vida da proteção do treino. `WearControlsUiTest` verifica os estados disponíveis, indisponíveis, pendentes e recuperados. Esses testes usam emuladores; não substituem o teste com celular e relógio físicos pareados, incluindo conclusão/edição de série e controles de descanso após bloquear o celular.

## Updates

### Tela durante o treino

Enquanto houver treino ativo e o app estiver em primeiro plano, `FLAG_KEEP_SCREEN_ON` mantém o visual âmbar com os mesmos timers em segundos. Após 15 segundos sem interação, o brilho da janela cai para 3%; o toque restaura o brilho normal definido pelo usuário. Quando o fabricante disponibiliza `android.sensor.wrist_tilt_gesture`, levantar o pulso também restaura o brilho. Esse sensor é registrado apenas enquanto a tela está escurecida. Sem o sensor, o toque continua disponível. Essa tela interativa consome mais bateria que o AOD real.

Ao encerrar o treino, sair do app ou entrar no ambiente por ação do sistema, são removidos o brilho temporário, o bloqueio de desligamento, o callback de escurecimento e o listener do pulso. Não são alteradas configurações globais do relógio.

`AmbientLifecycleObserver` continua como alternativa para transições explícitas do Wear OS: fundo preto, exercício, série e fase, com o horário de término do descanso em vez de segundos congelados. Animações e consultas periódicas param no ambiente. Ao despertar, retorna a interface âmbar e os controles aguardam confirmação nova do celular. Alarmes de descanso permanecem independentes da tela. Os testes verificam brilho, limpeza, segundos após 15 segundos de espera, preservação da edição e modo ambiente com pelo menos 85% de pixels pretos.

The upstream APK updater/download action is retired until an adapted signed release channel is reviewed. PWA service-worker updates remain. Inherited publishing, release/upload and mirror workflows are removed; compilation does not publish anything.

## Verified local delivery

### Referência aprovada com batimentos e engrenagem ao lado do tempo (14/10/2026)

Nome em arco e série centralizada no topo. O contador usa a largura da tela, com coração/número empilhados à esquerda e configuração com engrenagem à direita; o tempo ajusta de 32 a 40 sp para respeitar essas áreas. Os campos de carga/repetições têm superfície visual de 32 dp com alvo de toque de 48 dp. Fonte, ícone e formato da ação inferior permanecem. O descanso preserva seu botão de pausar/retomar e as ações de adicionar tempo/pular.

Compilação e 5 testes focados de instrumentação passaram (estados visuais, controles, início/batimentos e ação principal). Capturas inspecionadas em `frontend/android/build/wear-reference-review/`; `17-ready-heart.png` usa uma leitura controlada de 78 para verificar a distribuição, sem dados reais de sensor. APK debug SHA256 `e89ea29eced4ac0f84dc9ad52e72245a12eaa62bb2276704807909020b21ac5a`.

### Nome em arco e configuração à direita (14/10/2026)

O cabeçalho de treino e descanso agora mostra o exercício em um arco superior, com série logo abaixo, frequência cardíaca à esquerda e configuração no espaço da direita. `WearArcTitle` preserva o nome completo para acessibilidade e limita o texto visível com reticências quando necessário. A altura do cabeçalho principal caiu de 56 para 52 dp. Fonte, ícone e formato da ação inferior foram preservados.

Compilação e 4 testes de instrumentação (estados visuais, início/batimentos e controles) passaram. Capturas inspecionadas em `frontend/android/build/wear-arc-review/`. APK debug SHA256 `be60a0e537813a824f85c5bbbab53cde76470eb73fb64917e1388eca56e15836`.

### Fundo grafite com violeta escolhido (13/10/2026)

A escolha final substitui o teste azul/turquesa por grafite com luz violeta e superfícies correspondentes. A fonte peso 700 e o ícone de 28 dp da ação principal permanecem. Compilação e 3 testes focados de interface (estados visuais e fundo/ambiente) passaram. Captura final inspecionada em `frontend/android/build/wear-violet-review/02-complete.png`. APK debug SHA256 `466614aa3eaa2dba8bef0fec24ab836608c09ac8d741b2eb8b8d1570c5b3cd9a`.

### Fonte da ação principal e fundo azul/turquesa (13/10/2026)

A ação inferior usa Nunito peso 700, ícone de 28 dp (antes 18 dp) e ajuste de texto entre 16 e 20 sp em uma linha. A aplicação da fonte evita recriar o typeface quando o eixo variável já está correto: as atualizações periódicas de estado antes limpavam o eixo, enquanto o TextView mantinha a string em cache, deixando a ação visualmente mais fina.

Fundo azul profundo com turquesa e superfícies correspondentes, escolhido como teste enquanto a preferência de fundo estava pendente. Compilação e 4 testes focados de instrumentação passaram; capturas inspecionadas em `frontend/android/build/wear-button-review/`. APK debug SHA256 `72ccd6b74f81da77332577c35d99c6e94cc221a2601bfa11b042f99d5b75e79f`.

### Layout com cronômetro em destaque e ação inferior (13/10/2026)

Implementado o estudo visual aprovado: fundo cobre/vinho mais escuro, título reto em até duas linhas, série e frequência cardíaca compactas, cronômetro grande, carga/repetições editáveis menores e ação âmbar com borda inferior curva. A fonte Nunito usa explicitamente o eixo variável de peso. Não há “Pronto” na tela interativa; a fase continua na descrição acessível da série.

O botão principal oferece iniciar/consentir a coleta antes do esforço, aguarda uma leitura recente e passa a concluir durante o esforço. Conclusão sem sensor permanece em Opções > Batimentos e não aparece durante esforço com captura, evitando um rótulo que prometeria ignorar dados já coletados. Bloqueios por conexão e envio pendente foram preservados. Descanso mantém pausar, adicionar tempo e pular; edição e ambiente continuam disponíveis.

Verificação: compilação, 17 testes unitários e 20 testes de instrumentação passaram. O novo teste falhou antes da implementação e passou depois; cobre início sem sensor, conclusão alternativa, bloqueio de envio duplicado e troca para concluir durante esforço. Revisão independente identificou e confirmou a correção da ação alternativa durante captura. Capturas finais inspecionadas em `frontend/android/build/wear-material-review/`. APK debug: `frontend/android/wear/build/outputs/apk/debug/wear-debug.apk`, SHA256 `f24077b671fb465d567c594fbffa1393d2679ee657d05891895b6e648bc35cde`. Validação em relógio físico permanece pendente.

### Relógio cobre e vinho com tipografia arredondada (13/10/2026)

O ajuste posterior de espaçamento usa 6 dp entre cronômetro, carga/repetições e ações. A tela de descanso aproveita o espaço superior e mantém o coração dentro da borda redonda; a edição conserva os 8 dp entre ajuste e confirmação. As alturas de toque de 48 dp permanecem. Compilação e teste dos estados visuais passaram; capturas finais inspecionadas em `frontend/android/build/wear-spacing-review/`. SHA256 do APK após esse ajuste: `35feebfa3465c2bdcf5271d89f5557bba2d2adf23ceba86cb9a61cae1f20ff3d`.

O fundo escolhido combina cobre e vinho, preservando as superfícies âmbar e o modo ambiente preto. A fonte Nunito variável fica incluída no APK, com peso 600 em títulos e controles, 500 em textos secundários e 400 nos cronômetros e valores grandes. Números usam o recurso `tnum` para manter o alinhamento. Fonte obtida do projeto Google Fonts/Nunito; licença SIL OFL incluída em `wear/src/main/assets/licenses/NUNITO-OFL.txt`.

Compilação do relógio e 17 testes unitários passaram. No emulador Wear OS, 5 testes de interface (fundo, estados visuais e ambiente) passaram; capturas de treino, descanso e edição foram inspecionadas em `frontend/android/build/wear-copper-review/`. APK debug em `frontend/android/wear/build/outputs/apk/debug/wear-debug.apk`, SHA256 `c83fd5ac13ff30c4bcf585c2bb859432641e47dcac2ef7f677f8140f5b5c3248`. Validação em relógio físico ainda pendente.

See [Offline / Firestore verification](dev/OFFLINE_FIRESTORE_VERIFICATION.md) for exact product/artifact hashes, commands, actual device evidence and limits. An ordinary unconfigured APK stores training locally; cloud login requires a separately configured build. A demo-emulator APK is a distinct verification artifact requiring the named local servers and dedicated ADB reverse mappings. Preserve the ordinary APK before packaging demo assets and restore ordinary assets/configuration for the final local delivery. The seeded `VITE_DEMO` build flag is unrelated to Firebase emulator mode.

Android process termination before a local save confirmation may lose that unconfirmed edit. Confirmed revisions are read back from the owner-specific two-slot archive; corruption of the newest slot falls back to the other valid slot. Clearing all app data or uninstalling can remove those files and local media. WebView-only data loss and full app-data deletion are different operations and must be described separately in verification evidence.

Guest backup import/export works locally while offline. Signed-in backup restore requires a connection for the server-verified merge/replace preview; reconnect before importing. A connectivity failure leaves the backup unapplied and asks you to connect. Workouts and confirmed local training remain available offline.

### Wear expressive violet layout — 2026-10-14

Implemented the approved violet watch layout with gently moving native light ribbons, swipe navigation between workout and options, two page dots, and a small live heart status without a numeric BPM on the workout screen. Iniciar, Pausar and Confirmar share the same 124 × 48 dp touch target and bottom anchor. Load editing uses inline minus/value/plus and a smaller Cancelar control. Animation stops in ambient and when the activity leaves the foreground, respecting disabled system animations. Existing freshness, pending command, consent and editing guards remain.

Validation: `:wear:assembleDebug`, `:wear:assembleDebugAndroidTest`, `:wear:testDebugUnitTest` succeeded (17 unit tests); Android instrumentation returned `OK (21 tests)`, including page gestures/accessibility and real native captures. Reviewed actual screenshots in `frontend/android/build/wear-expressive-review/` (17-ready-heart, 04-rest, 08-options, 11-edit-load). APK: `frontend/android/wear/build/outputs/apk/debug/wear-debug.apk`; SHA-256 `0e64716815a1e1fe3615cbedd7f9ceddd4ab8d0469c174803f7ff25d290967d3`. Verified on the large round Wear OS emulator; physical watch verification remains with the user.

### Correction against the approved Wear mockup — 2026-10-14

The first expressive implementation did not reproduce the approved visual proportions. Corrected the lower action silhouette and centered icon/label as one group, moved workout title and timer to proportional positions, added outlined translucent pills, restored editor back and lavender adjustment buttons, and kept Reconectar visible on the options page. Replaced the approximate procedural backdrop with an aurora texture generated from the approved reference, sampled at half resolution and animated with gentle pan/scale/rotation. Background prompt and source path are recorded in `docs/design/wear-violet-background-prompt.txt`. Ambient/background motion cleanup remains covered.

Real native screenshots: `frontend/android/build/wear-mockup-correction/`. Full Android instrumentation passed 22 tests including compact watch geometry and visible lateral heart status; the existing 17 Java unit tests passed. Build and diff checks passed. APK: `frontend/android/build/wear-mockup-correction/opengym-wear-corrected.apk`; SHA-256 `b928872706ae405f0407d3bd2e8bf423b8672afe732a023a8a77f34cfe3f4587`.

### Local wave deformation — 2026-10-14

Replaced whole-image pan/zoom/rotation with a 20 × 20 native bitmap mesh. Smooth horizontal and vertical local waves deform the existing aurora artwork, fading to zero near its perimeter. The outer artwork stays fixed. A reused vertex array avoids per-frame allocations; animation remains scheduled every 150 ms only while the foreground UI permits motion. Ambient/background lifecycle cleanup and system animation preferences remain unchanged. No new dependency or newer Android API is required.

A regression test first failed on the old whole-image transform, then passed with the mesh: interior pixels change across phases, edge pixels stay fixed, and stopping restores the static texture. The full emulator suite passed 23 tests and the Java unit suite passed 17 tests. Native preview was recorded using the opt-in `wavePreview=true` visual fixture (`OK (1 test)`); MP4: `frontend/android/build/wear-wave-motion/preview.mp4`. APK: `frontend/android/build/wear-wave-motion/opengym-wear-waves.apk`; SHA-256 `f0805456d776031417c4b40a9ee7a751ee50c3bd94cfa2110bfad7dd69559e49`. Physical-watch rendering/performance remains to be verified on the user's device.

### Local Wear layout editor — 2026-10-14

Added an independent local editor at `frontend/tools/wear-layout/`, served through the existing Vite development server at `/tools/wear-layout/index.html`. Four editable scenes use the actual Nunito font, aurora image and primary button path. Supports drag, keyboard nudges, per-element sizing/positions/fonts, global colors and shared primary-button geometry, undo/reset, browser persistence, JSON import/export and PNG export. The optional WebGL background uses the same 20 × 20 mesh and wave equations as the native drawable. The editor does not automatically modify the APK; exported coordinates use a 225 dp reference and require native application/verification.

Verified in the in-app browser: four scenes, numeric width edit shared by rest/start, persistence after reload, keyboard movement, pointer dragging, restore, and actual downloaded JSON export preserving the changed position. No browser error logs were present. Model round-trip and malformed import checks passed; JavaScript syntax and diff checks passed. Native code and training data were not changed in this task. A launch script and usage guide are included alongside the editor. Screenshot: `frontend/android/build/wear-layout-editor/preview.png`.

### Applied the user's editor export — 2026-10-14

Validated the latest downloaded layout export and retained it as `docs/design/wear-layout-approved.json`. Applied the changed artwork coordinates to native UI: title y 7.5 / font 18.5, series y 57, centered heart at (112,40), workout timer at (111,105.5), rest timer at (111,98.5), shared primary button width 140.5 and center x 112, and load controls at x 38 / 185.5 and y 98. The load value now has more central room and retains its center at 112.5. Compact-watch fallback geometry and command guards remain intact. The sample load 333 in the export is demonstration content, not a change to training data.

Build succeeded; the full emulator suite passed 23 tests and the existing unit suite passed 17 tests. Visual captures include a three-digit load and fully visible 48 dp adjustment controls. Evidence: `frontend/android/build/wear-approved-layout/17-ready-heart.png`, `04-rest.png`, `11-edit-load.png`, `19-edit-long-load.png`. APK: `frontend/android/build/wear-approved-layout/opengym-wear-your-layout.apk`; SHA-256 `e7d46e471e4656b96c10fbe2d771bc45149b2a274efd182ade06e3b726ce41b4`.

### Physical-watch usability diagnosis — 2026-10-14

Read the watch's animation duration scale (1.0), battery saver (0), foreground/dozing state and BODY_SENSORS permission. Two settled awake screenshots showed 94,761 changed pixels between frames: the animation runs physically, but its deformation was visually subtle. Increased local wave amplitude and speed, preserving ambient/motion-preference cleanup and updating the visual editor equations. Consulted official Android hardware-acceleration and Wear navigation guidance.

Restored an explicit 48 dp back control on root options, added Android back handling for options/nested pages/editors, and relaxed page gesture threshold/direction tolerance. Remembered heart opt-in is bound to the exact verified active workout. The expected context travels in the service intent and must match cached active state plus the stored opt-in and permission across asynchronous Health Services startup. Explicit disable clears the remembered choice; another workout cannot inherit it. Source review found and resolved a cached-state startup race.

The phone's installed app was dated 2026-10-12. Rebuilt/synced/verified mobile assets and installed the updated personal-profile phone APK successfully, retaining app data. Weight profiles are selected via the exercise menu → Exercise settings → Weight type. Movement starts at 11.8 kg with step 6.8 kg. No live exercise profile or weights were changed automatically.

Validation: 24 focused web profile/protocol tests, 18 Java unit tests, and 23 emulator instrumentation tests passed; mobile bundle check and both native builds passed. APK copies: `frontend/android/build/wear-usability-fix/opengym-watch.apk` (SHA-256 `3a549ea8252a5a2f2be97c0ad6977dfb3cf06c8783b5ad0712e1ac0e36752d5d`) and `opengym-phone.apk` (`ea24d79c3bea24eaf564004d5d14653264a5c3fc9231c0b8bab5fa5a76d0204b`). Phone installation succeeded; watch install attempt dropped offline and was not confirmed. Requested a fresh wireless-debugging address before claiming physical watch delivery.

After the user reopened wireless debugging, discovered the fresh watch endpoint and installed the same verified APK with `install -r`: Success. Launched `com.fredc.opengym.test/com.fredc.opengym.WearActivity` successfully on the physical SM_L705F, preserving app data.

### Wear offline save and larger controls — 2026-10-16

Primary actions now use a 164 × 56 dp target (visible surface inset reduced to 6 dp), 18–20 sp text and 24 dp icons. Reps/load numbers use 18 sp and unit labels 11 sp; rest metrics use 16 sp. Removed the editor's top spacer to keep Confirm fully visible. Compact layout and full visibility assertions pass.

Added WearOutbox: one durable edit or completion saved synchronously before transmission, stable request ID on retries, pending/conflict indication and a review/discard flow. Unsent replay compares the original context, current set, values, unit and weight grid before using a freshly verified revision. Sent commands retain their original ID/revision. Rejections retain the action for review. App foreground sync drains the outbox. This is not a standalone offline workout: the next action/set waits for phone acknowledgement; starting sensor capture and rest controls still require the phone.

Decimal report (32.2 becoming 32) remains unreproduced. Added regressions for the full Movement sequence and actual phone edit/cascade storage; instrumentation confirms 25.4 → 32.2, display and durable JSON. No demonstrated rounding defect was found or claimed fixed. User says it seems to affect all exercises; physical reproduction is still required.

Validation: 19 focused web tests, 19 Java unit tests and 24 emulator instrumentation tests passed. The first instrument run found one outdated online-only assertion and a 1 dp editor clipping regression; both resolved before the passing full run. Final follow-up only replaces raw command names with exercise/set/value text in the pending-action dialog. Physical watch not connected via ADB during this task; no physical installation claimed.
