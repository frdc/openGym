# Movimento ao vivo no PC

Painel local para experimentar os sensores do relógio. Mostra a orientação medida e um antebraço ilustrativo com cotovelo fixo. Não mede a posição absoluta do braço nem a distância percorrida.

## Abrir

Com Node 22 e Android SDK/ADB instalados, na pasta `frontend`:

```powershell
npm run motion:viewer
```

Abra **http://127.0.0.1:5180**. O processo fica ativo até Ctrl+C. `OPENGYM_ADB` permite indicar outro executável ADB e `OPENGYM_MOTION_PORT` outra porta local.

O relógio precisa da versão debug atual do OpenGymTest (`android/wear/build/outputs/apk/debug/wear-debug.apk`). Instale com `adb -s ENDERECO install -r ...`, preservando os dados. O celular não participa desta conexão.

No relógio, ative **Opções do desenvolvedor → Depuração sem fio**, na mesma rede do PC. Se ainda não estiver pareado, use os endereços/código mostrados pelo relógio:

```powershell
adb pair IP:PORTA_DE_PAREAMENTO
adb connect IP:PORTA_DE_DEPURACAO
```

A porta de pareamento é diferente da porta de conexão e pode mudar. Nenhum código de pareamento é salvo pelo painel. Só relógios autorizados e conectados aparecem na lista. Toque **Conectar** no PC: a tela de sensores abre e acende no relógio. Se a rede cair, reconecte o ADB e use Conectar novamente.

## Experimentar

1. Mantenha o antebraço à frente, palma para baixo, topo da tela do relógio apontado para os dedos.
2. Use **Calibrar** para marcar esta posição como referência.
3. Mova/incline o braço mantendo o tronco na mesma direção. O modelo acompanha a orientação; rotação do pulso também afeta o resultado.
4. Recalibre se mudar de postura, de braço ou de sessão. O referencial de jogo pode desviar lentamente com o tempo.
5. Use a gravação/exportação para salvar dados JSON no PC. A gravação é temporária na memória do navegador, limitada a 30 minutos; exporte antes de fechar a página. O histórico de treinos não é alterado.

O painel identifica dados antigos e sensores indisponíveis. Ausência de orientação não é tratada como movimento zero. Os gráficos mostram aceleração e velocidade angular; não são uma trajetória em centímetros.

Interrupções breves do Wi-Fi não encerram imediatamente a sessão. Após 1 segundo sem dados novos, a pose fica congelada e o painel sinaliza falta de dados; a transmissão pode se recuperar mantendo a calibração. O relógio encerra envios bloqueados por 10 segundos, e a ponte no PC encerra uma sessão estabelecida após 12 segundos sem quadros válidos. Uma conexão inicial ainda exige resposta em 5 segundos. A fila de envio mantém apenas a amostra mais recente, e uma interrupção definitiva informa o motivo no painel.

**Encerrar:** Desconectar no PC ou Encerrar no relógio. Sair da tela de sensores também interrompe a aquisição. Fechar a última aba libera a sessão após 10 segundos; há limite de 30 minutos no relógio. O servidor só escuta neste PC, e o fluxo usa o túnel ADB existente, sem abrir uma porta Wi-Fi no relógio.

## Testes

```powershell
node --test tools/wear-motion/*.test.mjs
```

Os testes da ponte usam sockets locais reais e um dispositivo de protocolo controlado; isso não comprova a precisão da estimativa no braço. A verificação no emulador deve ser identificada como simulação, separada do teste físico.
