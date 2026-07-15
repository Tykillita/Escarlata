# Escarlata en dispositivos ESP32

Un ESP32 es un cliente periférico de Escarlata, no el host del backend. El servidor Node, PostgreSQL, Whisper y los proveedores de modelos siguen corriendo en un gateway: laptop, Raspberry Pi 5, mini PC o servidor remoto privado.

## Topología

```text
ESP32 (micrófono, botón, altavoz, sensores)
  └─ Wi-Fi + WSS/mTLS ─> Gateway Escarlata
       ├─ API de dispositivos y WebSocket
       ├─ Agent core / equipo de gemas
       ├─ PostgreSQL
       └─ STT, TTS y proveedores de modelo
```

## Contrato de dispositivo v1

- El ESP32 se registra con un `deviceId` y una credencial revocable distinta de las sesiones web.
- Transporte: WebSocket seguro en `/device/ws`, autenticado antes de aceptar audio o comandos.
- Mensajes compactos JSON al inicio: `device_hello`, `ptt_start`, `audio_chunk`, `ptt_end`, `cancel`, `status`.
- El servidor responde `ready`, `transcript`, `assistant_text`, `audio_chunk`, `error` y `command_state`.
- El audio usa Opus si el firmware lo soporta; WAV PCM mono 16 kHz es el fallback de integración inicial. El tamaño máximo se define por el gateway, nunca por el dispositivo.
- El ESP32 no recibe claves de proveedores, credenciales de base de datos ni historial completo de conversaciones.

## Fases de firmware

1. Botón PTT, LEDs de estado y texto/transcripción por serial para validar el contrato.
2. Micrófono I2S, streaming de fragmentos y reproducción I2S de TTS.
3. Provisionamiento Wi-Fi, credencial revocable y actualización OTA firmada.
4. Sensores y acciones locales limitadas por una allowlist; todo comando sensible requiere confirmación en el gateway.

## Host recomendado

Para una unidad doméstica siempre encendida: Raspberry Pi 5 de 8 GB o mini PC x86, PostgreSQL en Docker y Ollama/modelos en un host con capacidad suficiente. El ESP32 puede funcionar aunque el modelo esté en otro equipo de la red o en un proveedor remoto.
