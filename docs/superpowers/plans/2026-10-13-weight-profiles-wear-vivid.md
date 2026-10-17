# Perfis de carga e visual vivo do relógio

Desenho em conversa aprovado pelo usuário em 13/10/2026; execução nesta conversa.

**Objetivo:** criar tipos de peso salvos com nome, unidade, carga inicial e incremento, selecionáveis durante o exercício, e aplicar gradiente azul/verde/violeta com movimento suave e botões padronizados no relógio.

**Arquitetura:** perfis pessoais são um mapa com registros estampados no estado sincronizado existente. A configuração do exercício leva uma cópia do perfil selecionado: editar/excluir um perfil não modifica histórico nem treinos já iniciados. Helpers puros resolvem unidades e a grade de cargas, preservando o comportamento de exercícios antigos. O relógio recebe o início e passo efetivos no snapshot. O fundo é um Drawable nativo; movimento somente em primeiro plano fora do modo ambiente.

**Validação e limites:** sem dependências novas, sem publicação ou alterações de produção; manter propriedade dos dados, serialização offline/cloud, exportações, unidades, lados, aquecimentos, séries especiais e controles de descanso. Perfil selecionado não altera cargas já registradas. Perfis mantêm a unidade nativa; seleção converte para a unidade de exibição.

- [x] Helpers e testes de perfis: validação, grades 5/5,3/Movement, conversão, remoção, seleção sem alterar séries concluídas.
- [x] Persistência: defaults, classificação cloud, mesclagem estampada/reset e roundtrip de backup/codec.
- [x] UI: seletor Tipo de peso e gerenciamento dos perfis na configuração e treino; traduções pt-BR explícitas e packs existentes.
- [x] Propagação: controles, progressão e editor do relógio respeitam início/passo; compatibilidade sem perfil.
- [x] Visual nativo: gradiente/brilho/movimento suave; pausar em segundo plano/ambiente; mesmo arredondamento e estilo de botões.
- [x] Verificação: testes focados, locais, bundle mobile, builds Java21, interface no emulador e revisão.

Revisão independente encontrou duas falhas corrigidas e verificadas: snapshot removido do compartilhamento de planos e arredondamento de conversão que provocava um falso aumento de carga. A suíte completa passou (354 arquivos/3.876 testes), e o ajuste final do contador de recuperação passou em 91 testes focados. Testes nativos finais: 17 unitários Wear e 19 instrumentados. Builds, traduções e checks de artefatos passaram. Validação física/instalação nos aparelhos do usuário segue pendente; APKs prontos e capturas em `frontend/android/build/wear-vivid-review` e `weight-profile-review`.
