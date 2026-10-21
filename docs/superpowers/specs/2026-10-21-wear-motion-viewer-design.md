# Visualizador local de movimento do relógio

O usuário quer mover o braço e observar no PC o que o relógio mede, com implementação completa e execução direta já autorizada. O primeiro resultado mostra orientação real e um antebraço ilustrativo com cotovelo fixo; não promete posição absoluta, centímetros percorridos, postura do corpo ou reconhecimento de exercícios.

## Componentes

- Activity apenas na variante debug do Wear, `com.fredc.opengym.WearMotionActivity`. Acelerômetro, giroscópio, vetor de rotação de jogo (fallback vetor de rotação) e aceleração linear quando disponíveis. Aquisição a 50 Hz, transmissão limitada a 25 Hz. Não altera treino, dados ou coleta cardíaca.
- Transporte NDJSON por `LocalServerSocket("opengym-motion-v1")`, acessível ao app/shell/root e encaminhado por ADB. Sem porta Wi-Fi aberta no relógio. Activity visível mantém a tela ligada, mostra estado e botão Encerrar; sair desregistra sensores e fecha sockets. Limite de sessão de 30 minutos.
- Servidor Node sem dependências adicionais em `frontend/tools/wear-motion/server.mjs`, vinculado a `127.0.0.1:5180`; túnel ADB em porta dinâmica local. Descobre exclusivamente dispositivos com `android.hardware.type.watch`, inicia a Activity, transmite SSE ao navegador. Rejeita origens/Host externos e comandos arbitrários, não toca no celular/TV. Desconectar remove só o túnel criado.
- Interface em português em `frontend/tools/wear-motion/`: vista 3D em Canvas, orientação, direções e gráficos de aceleração/rotação; conectar/desconectar, calibrar, pausar visualização, câmera e gravação/exportação local JSON. Sem dependência CDN, dados sintéticos ou movimento fictício quando desconectado.

## Contrato do relógio

Uma linha JSON por mensagem, máximo 8 KiB. `hello`: `{v:1,type:"hello",session:<UUID>,model:<string>,orientation:"game_rotation_vector"|"rotation_vector"|"unavailable",sensors:{orientation:<boolean>,accel:<boolean>,gyro:<boolean>,linear:<boolean>},rateHz:25}`.

`sample`: `{v:1,type:"sample",session:<UUID>,seq:<inteiro crescente>,tMs:<tempo monotônico em ms>,q:[x,y,z,w]|null,accel:[x,y,z]|null,gyro:[x,y,z]|null,linear:[x,y,z]|null,accuracy:<0..3>,orientationAgeMs:<idade em ms>|null}`. Quaternion normalizado transforma eixos do relógio no referencial do sensor. Aceleração em m/s², velocidade angular em rad/s. Valores finitos, arrays de tamanho exato; canal opcional ausente é null. `session` muda ao retomar a Activity. Nenhuma amostra antes de hello. O PC acrescenta `receivedAt` (Date.now).

## Contrato PC/navegador

- GET `/api/devices` => `{devices:[{serial,model}]}` (somente relógios autorizados no ADB).
- POST `/api/connect` JSON `{serial?:string}`; sem serial escolhe apenas se há exatamente um relógio. GET `/api/status` retorna estado atual.
- POST `/api/disconnect` encerra leitura, túnel e Activity de movimento, sem force-stop do app de treino.
- GET `/events` SSE `status`, `hello`, `sample`. Status `{state:"disconnected"|"connecting"|"connected"|"error",message:string,device?:{serial,model}}`. Conexão rompida é sinalizada, nunca continua como ao vivo. Controles POST exigem Origin local quando informado e Content-Type application/json; servidor permite só Host local na sua porta. SSE limita clientes e descarta cliente lento.

## Referencial e interface

Calibração: antebraço à frente, palma para baixo e topo da tela do relógio apontado para os dedos; tronco permanece na mesma direção. Guardar q0. Quaternion de exibição = B × inverso(q0) × q, com B rotação de -90° sobre X. Eixos da cena: X direita, Y cima, -Z frente. Antebraço ilustrativo segue +Y local do relógio. Com o braço esquerdo/direito a origem ilustrativa pode mudar, sem inventar medição do ombro/cotovelo. Recalibrar após mudar de posição/retomar sessão. Só permite calibrar com amostra fresca e orientação disponível. Amostras >1 s são antigas; congelar pose e exibir desconectado/sem dados. Sem orientação, gráficos continuam disponíveis com aviso.

Gravação é memória do navegador, limitada a 30 minutos a 25 Hz. Exportação explícita JSON com unidades, referencial e amostras brutas, incluindo gaps/recalibrações; não altera histórico de treinos. Ao atingir limite encerra gravação e informa. Desconexão encerra gravação preservando exportação. Indicadores dizem “orientação medida” e “posição ilustrativa · cotovelo fixo”.

## Validação

Testar matemática com rotações conhecidas, quaternion invertido de mesmo sinal físico, calibração e entradas inválidas; testar protocolo fragmentado/malformado, seleção segura de dispositivos, status desconectado e endpoints locais. Compilar APK debug e validar Activity/sensores, transporte e saída com teste instrumentado. Inspecionar interface em navegador e conectar ao relógio físico quando disponível. Não chamar dados de simulador de dados reais.
