# WebSocket Proxy API Simplificado

## Descripción
Servidor WebSocket proxy que implementa las 4 reglas especificadas en `definition.txt`:
1. Asignación de tokens de 4 caracteres alfanuméricos (1-9, A-Z)
2. Envío de mensajes a uno o múltiples destinos
3. Seguimiento de pares de conexión para notificaciones de desconexión
4. Canales públicos con expiración de 20 minutos

## Conexión
Conectarse al servidor WebSocket:
```
ws://localhost:4001/
```

Al conectarse, el servidor responde con:
```json
{
  "type": "connected",
  "token": "ABCD",
  "timestamp": "2026-03-01T04:33:38.141Z"
}
```

## Mensajes

### Enviar mensaje a uno o múltiples destinos
```json
{
  "to": ["ABCD", "EFGH"],
  "message": "Texto del mensaje"
}
```

**Respuesta exitosa:**
```json
{
  "type": "message_sent",
  "sent": 2,
  "total": 2,
  "timestamp": "2026-03-01T04:33:38.141Z"
}
```

**Respuesta con errores (algunos destinos no encontrados):**
```json
{
  "type": "message_sent",
  "sent": 1,
  "total": 2,
  "failed": ["EFGH"],
  "timestamp": "2026-03-01T04:33:38.141Z"
}
```

### Recibir mensaje
```json
{
  "type": "message",
  "from": "ABCD",
  "message": "Texto del mensaje",
  "timestamp": "2026-03-01T04:33:38.141Z"
}
```

### Publicar en canal público
Cada cliente puede publicarse en un canal a la vez.
```json
{
  "type": "publish",
  "channel": "nombre-del-canal"
}
```

**Respuesta:**
```json
{
  "type": "published",
  "channel": "nombre-del-canal",
  "timestamp": "2026-03-01T04:33:38.141Z"
}
```

### Listar tokens en canal
Obtener los últimos 100 tokens no expirados en un canal.
```json
{
  "type": "list",
  "channel": "nombre-del-canal"
}
```

**Respuesta:**
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
Cuando un cliente con el que te has comunicado se desconecta:
```json
{
  "type": "disconnected",
  "token": "ABCD",
  "timestamp": "2026-03-01T04:33:38.141Z"
}
```

### Errores
```json
{
  "type": "error",
  "error": "Mensaje de error descriptivo"
}
```

## Reglas del Sistema

### Tokens
- 4 caracteres alfanuméricos (1-9, A-Z)
- Asignados automáticamente al conectar
- Eliminados inmediatamente al desconectar
- No hay recuperación de conexión (nuevo token al reconectar)

### Mensajes
- El campo `to` puede ser un string (un destino) o array (múltiples destinos)
- No se pueden enviar mensajes a uno mismo
- Los mensajes fallan silenciosamente para destinos no encontrados
- Se registran pares de conexión para cada mensaje exitoso

### Pares de Conexión
- Se almacenan cuando un mensaje se entrega exitosamente
- Se usan solo para notificar desconexiones
- Se eliminan cuando uno de los clientes se desconecta

### Canales Públicos
- Cada cliente puede publicarse en un canal a la vez
- Máximo 100 tokens por canal (FIFO)
- Los tokens expiran después de 20 minutos
- Cualquier cliente puede listar tokens en cualquier canal

## Ejemplos de Uso

### JavaScript (Node.js)
```javascript
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:4001/');

ws.on('open', () => {
  console.log('Conectado');
});

ws.on('message', (data) => {
  const msg = JSON.parse(data);
  
  switch (msg.type) {
    case 'connected':
      console.log(`Token asignado: ${msg.token}`);
      break;
    case 'message':
      console.log(`Mensaje de ${msg.from}: ${msg.message}`);
      break;
    case 'disconnected':
      console.log(`Cliente ${msg.token} desconectado`);
      break;
  }
});

// Publicar en canal
ws.send(JSON.stringify({
  type: 'publish',
  channel: 'game-lobby'
}));

// Enviar mensaje
ws.send(JSON.stringify({
  to: ['ABCD', 'EFGH'],
  message: '¡Hola a todos!'
}));
```

## Limitaciones
- Máximo 100 tokens por canal
- Tokens expiran después de 20 minutos en canales
- No hay autenticación
- No hay cifrado (usar WSS en producción)
- No hay persistencia (todo en memoria)

## Iniciar Servidor
```bash
cd simple-websocket-proxy
npm install
node server.js
```

O con variables de entorno:
```bash
PORT=4002 node server.js
```

## Testing
```bash
node testSimple.js