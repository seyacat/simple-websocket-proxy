# Simple WebSocket Proxy con Modos Host/Guest

Un servidor WebSocket proxy que permite comunicación entre clientes usando tokens cortos alfanuméricos, con soporte para modos host/guest, suscripciones y broadcast.

## Características

- **Tokens cortos alfanuméricos**: Identificación simple de clientes (ej: "ABC123")
- **Modos host/guest**: Cada cliente puede ser host (crea canales) o guest (se suscribe a canales)
- **Sistema de suscripciones**: Guests pueden suscribirse a hosts usando su token corto
- **Broadcast**: Hosts pueden enviar mensajes a todos sus guests suscritos
- **Mensajería directa**: Comunicación punto a punto entre cualquier cliente
- **Reconexión persistente**: Los tokens se mantienen por 10 minutos después de desconexión
- **Estadísticas en tiempo real**: Endpoint HTTP para monitorear conexiones y suscripciones

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

### Endpoints HTTP

- `GET /status` - Estado del servidor y estadísticas
- `GET /tokens` - Lista de tokens cortos activos

## Protocolo WebSocket

### Conexión inicial

Conectar al servidor WebSocket:
```
ws://localhost:4001/
```

El servidor responde con:
```json
{
  "type": "connection_established",
  "uuid": "QmFzZTY0XzE3MDk4NzY1NDMyMQ...",
  "shortToken": "ABC123",
  "isReconnection": false,
  "message": "Nueva conexión establecida"
}
```

### Reconexión

Para reconectar con el mismo UUID:
```
ws://localhost:4001/?uuid=TU_UUID
```

### Modos Host/Guest

#### Establecer modo
```json
{
  "type": "set_mode",
  "mode": "host"  // o "guest"
}
```

Respuesta:
```json
{
  "type": "mode_set",
  "mode": "host",
  "message": "Modo cambiado a host",
  "timestamp": "2026-02-28T05:00:00.000Z"
}
```

#### Suscribirse a un host (solo modo guest)
```json
{
  "type": "subscribe",
  "to": "ABC123"  // token corto del host
}
```

Respuesta:
```json
{
  "type": "subscribed",
  "to": "ABC123",
  "message": "Suscripción exitosa",
  "timestamp": "2026-02-28T05:00:00.000Z"
}
```

#### Desuscribirse
```json
{
  "type": "unsubscribe"
}
```

### Envío de mensajes

#### Mensaje directo (a cualquier cliente)
```json
{
  "to": "DEF456",
  "message": "Hola cliente DEF456"
}
```

#### Broadcast (host a todos sus subscribers)
```json
{
  "to": "ABC123",  // el host envía a SU PROPIO token
  "message": "Hola a todos mis guests!"
}
```

### Tipos de mensajes recibidos

#### Mensaje directo recibido
```json
{
  "type": "message",
  "from": "ABC123",
  "message": "Hola cliente",
  "timestamp": "2026-02-28T05:00:00.000Z"
}
```

#### Broadcast recibido (por guests)
```json
{
  "type": "broadcast_message",
  "from": "ABC123",
  "message": "Hola a todos mis guests!",
  "timestamp": "2026-02-28T05:00:00.000Z"
}
```

#### Notificaciones del sistema

**Nuevo subscriber** (recibido por host):
```json
{
  "type": "new_subscriber",
  "guest": "DEF456",
  "subscribersCount": 3,
  "timestamp": "2026-02-28T05:00:00.000Z"
}
```

**Subscriber desconectado** (recibido por host):
```json
{
  "type": "subscriber_disconnected",
  "guest": "DEF456",
  "subscribersCount": 2,
  "timestamp": "2026-02-28T05:00:00.000Z"
}
```

**Host desconectado** (recibido por guests):
```json
{
  "type": "host_disconnected",
  "host": "ABC123",
  "message": "El host se ha desconectado",
  "timestamp": "2026-02-28T05:00:00.000Z"
}
```

## Reglas del sistema

1. **Un cliente por token**: Cada token corto está asociado a un solo cliente activo
2. **Modo único**: Un cliente solo puede estar en modo host o guest a la vez
3. **Suscripción única**: Un guest solo puede estar suscrito a un host a la vez
4. **Broadcast automático**: Cuando un host envía un mensaje a su propio token, se envía a todos sus subscribers
5. **Limpieza automática**: Al cambiar de modo o desconectarse, se limpian las suscripciones automáticamente
6. **Tokens temporales**: Los tokens se liberan después de 10 minutos de inactividad

## Ejemplo de flujo

### Escenario: Juego multijugador simple

1. **Jugador 1 (Host)**:
   - Se conecta al servidor
   - Establece modo `host`
   - Comparte su token corto (ej: "ABC123") con otros jugadores
   - Envía actualizaciones de juego a todos los guests suscritos

2. **Jugador 2 (Guest)**:
   - Se conecta al servidor
   - Establece modo `guest`
   - Se suscribe al host "ABC123"
   - Recibe actualizaciones del juego
   - Puede enviar mensajes directos al host u otros guests

3. **Jugador 3 (Guest)**:
   - Se conecta al servidor
   - Establece modo `guest`
   - Se suscribe al mismo host "ABC123"
   - Recibe las mismas actualizaciones

## Testing

### Test básico de tokens
```bash
node testToken.js
```

### Test completo del sistema de modos y suscripciones
```bash
node testSubscription.js
```

**Nota**: Asegúrate de que el servidor esté corriendo antes de ejecutar los tests.

## API de estado

### `GET /status`
```json
{
  "status": "online",
  "activeConnections": 5,
  "tokenStats": {
    "activeShortTokens": 5,
    "releasedShortTokens": 2,
    "currentShortTokenLength": 4,
    "expirationTimeMinutes": 10
  },
  "activeShortTokens": {
    "ABC123": {
      "uuid": "...",
      "ip": "192.168.1.100",
      "lastActivity": "2026-02-28T05:00:00.000Z",
      "assignedAt": "2026-02-28T04:55:00.000Z",
      "inactiveForMinutes": 0
    }
  },
  "modeStats": {
    "hosts": 1,
    "guests": 3,
    "noMode": 1,
    "totalSubscriptions": 3,
    "hostsWithSubscribers": [
      {
        "shortToken": "ABC123",
        "subscribers": ["DEF456", "GHI789", "JKL012"],
        "subscriberCount": 3
      }
    ]
  },
  "timestamp": "2026-02-28T05:00:00.000Z"
}
```

## Configuración

Variables de entorno:
- `PORT`: Puerto del servidor (default: 4001)

Archivo `.env`:
```env
PORT=4001
```

## Estructura del proyecto

- `server.js` - Servidor principal WebSocket
- `tokenManager.js` - Gestión de tokens cortos
- `testToken.js` - Tests del sistema de tokens
- `testSubscription.js` - Tests del sistema de modos y suscripciones
- `package.json` - Dependencias y scripts

## Dependencias

- `ws` - Servidor WebSocket
- `dotenv` - Manejo de variables de entorno
- `nodemon` - Recarga automática en desarrollo (dev dependency)

## Licencia

MIT