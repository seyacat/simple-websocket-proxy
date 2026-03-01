# Simple WebSocket Proxy Simplificado

Un servidor WebSocket proxy que implementa las 4 reglas especificadas en `definition.txt`:
1. Asignación de tokens de 4 caracteres alfanuméricos (1-9, A-Z)
2. Envío de mensajes a uno o múltiples destinos
3. Seguimiento de pares de conexión para notificaciones de desconexión
4. Canales públicos con expiración de 20 minutos

## Características

- **Tokens cortos alfanuméricos**: 4 caracteres (1-9, A-Z) asignados automáticamente
- **Mensajería múltiple**: Envío a uno o varios destinos simultáneamente
- **Notificaciones de desconexión**: Aviso cuando clientes pareados se desconectan
- **Canales públicos**: Publicación y listado de tokens en canales
- **Expiración automática**: Tokens en canales expiran después de 20 minutos
- **Simple y minimalista**: Solo las funcionalidades requeridas

## Instalación

```bash
npm install
```

## Uso

### Iniciar servidor

```bash
npm start
# o para desarrollo con recarga automática
npm run dev
```

El servidor se inicia en `ws://localhost:4001` por defecto (configurable con variable de entorno `PORT`).

## Respuestas del Servidor

### Al conectar
```json
{
  "type": "connected",
  "token": "ABCD",
  "timestamp": "2026-03-01T04:33:38.141Z"
}
```

### Mensaje recibido de otro cliente
```json
{
  "type": "message",
  "from": "ABCD",
  "message": "Texto del mensaje",
  "timestamp": "2026-03-01T04:33:38.141Z"
}
```

### Confirmación de mensaje enviado
```json
{
  "type": "message_sent",
  "sent": 2,
  "total": 2,
  "timestamp": "2026-03-01T04:33:38.141Z"
}
```

### Confirmación de mensaje enviado con errores
```json
{
  "type": "message_sent",
  "sent": 1,
  "total": 2,
  "failed": ["EFGH"],
  "timestamp": "2026-03-01T04:33:38.141Z"
}
```

### Confirmación de publicación en canal
```json
{
  "type": "published",
  "channel": "nombre-del-canal",
  "timestamp": "2026-03-01T04:33:38.141Z"
}
```

### Lista de tokens en canal
```json
{
  "type": "channel_list",
  "channel": "nombre-del-canal",
  "tokens": ["ABCD", "EFGH", "IJKL"],
  "count": 3,
  "maxEntries": 100,
  "timestamp": "2026-03-01T04:33:38.141Z"
}
```

### Notificación de desconexión
```json
{
  "type": "disconnected",
  "token": "ABCD",
  "timestamp": "2026-03-01T04:33:38.141Z"
}
```

### Error
```json
{
  "type": "error",
  "error": "Mensaje de error descriptivo"
}
```

## Protocolo WebSocket

### Conexión inicial
Conectar al servidor WebSocket:
```
ws://localhost:4001/
```

### Enviar mensaje
```json
{
  "to": ["ABCD", "EFGH"],
  "message": "Texto del mensaje"
}
```

### Publicar en canal
```json
{
  "type": "publish",
  "channel": "nombre-del-canal"
}
```

### Listar tokens en canal
```json
{
  "type": "list",
  "channel": "nombre-del-canal"
}
```

## API Completa

Ver [API.md](API.md) para documentación detallada de todos los mensajes y respuestas.

## Testing

Ejecutar el script de prueba:
```bash
node testSimple.js
```

## Reglas del Sistema

### Tokens
- 4 caracteres alfanuméricos (1-9, A-Z)
- Asignados automáticamente al conectar
- Eliminados inmediatamente al desconectar
- No hay recuperación de conexión (nuevo token al reconectar)

### Mensajes
- El campo `to` puede ser string (un destino) o array (múltiples destinos)
- No se pueden enviar mensajes a uno mismo
- Los mensajes fallan silenciosamente para destinos no encontrados

### Pares de Conexión
- Se almacenan cuando un mensaje se entrega exitosamente
- Se usan solo para notificar desconexiones
- Se eliminan cuando uno de los clientes se desconecta

### Canales Públicos
- Cada cliente puede publicarse en un canal a la vez
- Máximo 100 tokens por canal (FIFO)
- Los tokens expiran después de 20 minutos
- Cualquier cliente puede listar tokens en cualquier canal

## Estructura del Proyecto

```
simple-websocket-proxy/
├── server.js           # Servidor WebSocket principal
├── tokenManager.js     # Gestión de tokens
├── testSimple.js       # Script de prueba
├── API.md             # Documentación de API
├── definition.txt     # Especificación de requisitos
├── package.json       # Dependencias
└── plans/            # Planes y arquitectura
```

## Comparación con Versión Anterior

| Característica | Versión Anterior | Versión Simplificada |
|----------------|------------------|----------------------|
| **Líneas de código** | 767 | 371 |
| **Modos host/guest** | Sí | No |
| **Suscripciones** | Sí | No |
| **Broadcast** | Sí | No |
| **Tokens** | 10 minutos de retención | Eliminación inmediata |
| **UUID/IP validación** | Compleja | Simple |
| **HTTP endpoints** | /status, /tokens | Ninguno |
| **Canales públicos** | FIFO 20 hosts | 100 tokens por canal |
| **Expiración** | 10 minutos | 20 minutos |

## Requisitos

- Node.js >= 14.0.0
- Dependencias: `ws`, `dotenv`

## Licencia

MIT