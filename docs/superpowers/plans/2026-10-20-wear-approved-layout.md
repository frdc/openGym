# Aplicar o layout aprovado ao Wear OS

Referência aprovada: `frontend/tools/wear-layout/mockup-rest.html`.

- [x] Unificar timer e métricas em treino/descanso, com Pular à esquerda e +15 s à direita, sem superfícies visíveis. Preservar áreas de toque e ações locais existentes.
- [x] Substituir os pontos por Opções no alto à direita, sem fundo, e retorno explícito. Preservar as configurações e o gesto existentes.
- [x] Conferir limites de toque em 192/225 dp, navegação e ações; executar testes Wear, compilar APK e inspecionar capturas nativas.

Execução direta na branch existente `codex/wear-standalone`, autorizada pelo usuário. O mockup aprovado é a especificação visual; sem alterações de contrato/sincronização. Validar telas desconectadas, descanso pausado, edição de carga e séries que exigem o celular. Não há relógio físico conectado no início desta execução.

Resultado: 40 testes unitários e 28 testes instrumentados aprovados; os dois testes de geometria/estados visuais também passaram no emulador com densidade equivalente a 192 dp. Após o último ajuste de textos longos, a compilação e o teste de estados visuais passaram novamente. Comparação visual das capturas nativas de treino/descanso com o mockup em `frontend/android/wear/build/layout-evidence/comparison.html`; APK em `frontend/android/wear/build/outputs/apk/debug/wear-debug.apk`. Em 2026-10-21, os APKs foram instalados preservando dados no Galaxy Watch Ultra e no Galaxy S23 Ultra; abertura dos dois aplicativos confirmada via ADB.
