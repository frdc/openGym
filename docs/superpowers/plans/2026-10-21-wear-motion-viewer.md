# Wear motion viewer implementation plan

> **For agentic workers:** Use executing-plans with independent, disjoint sensor/viewer work under dispatching-parallel-agents, then requesting-code-review. Execução direta autorizada pelo usuário, sem novo ciclo de aprovação.

**Goal:** Entregar visualizador no PC conectado ao relógio, com orientação ao vivo, calibração e exportação local.
**Architecture:** Activity debug → socket local encaminhado pelo ADB → servidor loopback/SSE → Canvas no navegador.
**Tech Stack:** Java 21/SDK35, Node nativo, HTML/CSS/JavaScript sem novas dependências.
**Spec:** `docs/superpowers/specs/2026-10-21-wear-motion-viewer-design.md`.

## Global constraints

Preservar treino/standalone e dados. Apenas sensores de movimento. Sem posição absoluta inventada. Activity/manifest exclusivamente debug. Servidor em 127.0.0.1. Interface em português. Nenhuma publicação automática além do push solicitado da branch.

## Review focus

Reconexão não pode misturar referenciais de sessões; sensor indisponível não pode virar valor zero; cliente lento não pode acumular memória; requisições de outro site não podem iniciar ADB; fechar o visualizador/Activity deve liberar sensores e túnel. Cada componente testa os casos que controla.

## Tasks

- [x] 1. Activity e transporte debug (`wear/src/debug/AndroidManifest.xml`, `wear/src/debug/java/com/fredc/opengym/WearMotionActivity.java` e classes auxiliares). Primeiro teste de protocolo/lifecycle; implementar sensores e socket pelo contrato; compilar e testar no dispositivo/emulador.
- [x] 2. Modelo e UI (`frontend/tools/wear-motion/{motion.mjs,motion.test.mjs,index.html,viewer.mjs,style.css}`). Primeiro testes de rotações/calibração/frescor; implementar UI sem dados falsos e exportação limitada. Validar em navegador.
- [x] 3. Ponte local (`frontend/tools/wear-motion/{server.mjs,protocol.mjs,server.test.mjs,protocol.test.mjs}`). Primeiro testes de parsing, HTTP e descoberta/seleção; implementar ADB com argumentos sem shell e túnel próprio, SSE e status. Validar transporte real e desconexão.
- [x] 4. Integrar, revisar, instalar e abrir: testes Node/Java/instrumentação, inspeção do painel, documentação de uso e diário. Instalar APK preservando dados, iniciar painel e conectar ao relógio. Registrar limite físico se dispositivo ausente. Usuário informou estar fora de casa: instalação física fica para quando o relógio estiver acessível.

## Progress

- Base pré-visualizador: commit `77831066`. Limpeza de intermediários liberou ~186 MB; APKs, evidências e configurações locais mantidos. Push concluído em `frdc/openGym`, branch `codex/wear-standalone`, após autorização explícita do usuário.

- Implementação concluída: Activity debug isolada, ponte ADB loopback e painel 3D com calibração, gráficos e exportação JSON.
- Validação final: 29 testes Node, 51 unitários Wear e 5 instrumentados motion aprovados. Suíte web existente: 356 arquivos / 3.905 testes aprovados.
- Fluxo real no emulador: conexão, calibração, alteração dos sensores, rotação da cena, gravação de 7.262 amostras e exportação JSON conferida. Dados identificados como emulados. Revisão independente aprovada após correções de encerramento e expiração individual dos sensores.
- Limite: APK novo compilado e instalado somente no emulador. O usuário está fora de casa; precisão no braço e instalação física ainda não verificadas.
