# Reconexão e sincronização explícita do relógio

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Execução direta autorizada pelo usuário nesta conversa; sem novas aprovações de etapas.

**Goal:** Sincronizar séries e batimentos pendentes sem descartá-los; atualizar o relógio ao acrescentar exercícios; oferecer “Sincronizar com o relógio” no treino do celular.

**Architecture:** Reusar os diários duráveis e os ACKs existentes. Carregamento/reinício do publicador é indisponibilidade temporária. Um recibo persistido acompanha também a publicação de uma nova sequência, permitindo reconhecer ações já importadas antes de trocar a base. O botão solicita primeiro a fila do relógio, aguarda confirmação e só então publica o estado atual, com confirmação de aplicação no relógio. Capturas cardíacas usam a fila existente e permanecem locais até seus próprios ACKs; a interface distingue batimentos ainda pendentes.

**Tech Stack:** React/Zustand, Capacitor, Java 21, Wear Data Layer; sem dependências novas.

**Spec:** Contrato existente em `../specs/2026-10-19-wear-standalone-design.md`, complementado pelos pedidos do usuário nesta conversa. Não recuperar dados antigos; não descartar ou sobrescrever pendências.

## Global Constraints
- Ações só recebem sucesso após gravação durável; reenvio não duplica séries.
- Perfil/sessão/stream diferentes não recebem os dados de outra origem.
- Sem reset, limpeza de dados dos aparelhos ou descarte automático de conflitos.
- Confirmação de envio não equivale a confirmação de aplicação.

## Review Focus
- Comando chegando durante a hidratação do celular: resposta temporária, retry após carregamento.
- Novo exercício antes de o ACK chegar: reconhecer somente o prefixo comprovadamente salvo.
- ACK perdido seguido de reenvio depois de uma alteração no celular: idempotência sem apagar essa alteração.
- Queda, aparelho ausente, troca de sessão e conflito durante o botão: aviso, dados preservados.
- Batimentos ainda em coleta/envio: não anunciar sua entrega sem ACK nem apagá-los com atualização do treino.

## Tasks
- [x] Reproduzir hidratação e ACK perdido em testes de ponte/replay; corrigir respostas temporárias e recibos persistidos (JS + WearStandalone).
- [x] Testar atualização após concluir a sequência e acrescentar exercício; garantir que dados realmente pendentes continuam protegidos.
- [x] Implementar pedido explícito correlacionado no transporte nativo e no serviço Wear, com recebimento antes da publicação e confirmação final; testar o coordenador e a aplicação em background.
- [x] Adicionar botão e resultado acessível junto a “Abrir no relógio”; testar o fluxo visível e traduzir as mensagens.
- [x] Rodar regressões web e Android, compilar APKs, registrar resultados; instalar apenas nos aparelhos acessíveis e informar limites da validação física.

## Resultado

- 358 arquivos / 3.914 testes web; 6 unitários Android do celular e 56 do relógio; 10 instrumentados no emulador aprovados.
- Builds mobile, APKs debug do celular/relógio e APK instrumentado aprovados. Idiomas: 17 packs / 2.037 chaves; literais traduzidos verificados.
- Revisão identificou confirmação indevida quando apenas o estado remoto era gravado. Regressão real de SharedPreferences falhou antes da correção e passou depois: o serviço propaga falha do documento standalone, preserva a versão anterior e permite repetir o mesmo snapshot.
- Usuário escolheu testar depois. APKs preparados; esta atualização não foi instalada nos aparelhos físicos. Nenhuma recuperação de dados antigos foi executada. Servidor do visualizador de movimento continua encerrado.
