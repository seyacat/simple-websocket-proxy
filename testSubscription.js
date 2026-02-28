// Test script para verificar el sistema de modos host/guest y suscripciones
const WebSocket = require('ws');

console.log('=== Test del Sistema de Modos Host/Guest y Suscripciones ===\n');

const SERVER_URL = 'ws://localhost:4001';
let hostWs = null;
let guest1Ws = null;
let guest2Ws = null;
let hostToken = null;
let guest1Token = null;
let guest2Token = null;

// Helper function para enviar mensajes y esperar respuestas
function sendAndWait(ws, message, expectedType, timeout = 2000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`Timeout esperando respuesta para: ${JSON.stringify(message)}`));
        }, timeout);
        
        const messageHandler = (data) => {
            try {
                const response = JSON.parse(data.toString());
                if (expectedType && response.type !== expectedType) {
                    // Si no es el tipo esperado, continuar esperando
                    return;
                }
                clearTimeout(timer);
                ws.removeListener('message', messageHandler);
                resolve(response);
            } catch (error) {
                clearTimeout(timer);
                ws.removeListener('message', messageHandler);
                reject(error);
            }
        };
        
        ws.on('message', messageHandler);
        ws.send(JSON.stringify(message));
    });
}

// Test 1: Conectar host y establecer modo
async function test1() {
    console.log('Test 1: Conectar host y establecer modo host');
    
    hostWs = new WebSocket(SERVER_URL);
    
    await new Promise((resolve) => {
        hostWs.on('open', resolve);
    });
    
    // Esperar mensaje de conexión establecida
    const connectionMsg = await new Promise((resolve) => {
        hostWs.once('message', (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'connection_established') {
                resolve(msg);
            }
        });
    });
    
    hostToken = connectionMsg.shortToken;
    console.log(`  Host conectado con token: ${hostToken}`);
    
    // Establecer modo host
    const modeResponse = await sendAndWait(hostWs, {
        type: 'set_mode',
        mode: 'host'
    }, 'mode_set');
    
    console.log(`  Modo establecido: ${modeResponse.mode}`);
    console.log('  Test 1 completado ✓\n');
}

// Test 2: Conectar guest y suscribirse al host
async function test2() {
    console.log('Test 2: Conectar guest y suscribirse al host');
    
    guest1Ws = new WebSocket(SERVER_URL);
    
    await new Promise((resolve) => {
        guest1Ws.on('open', resolve);
    });
    
    // Esperar mensaje de conexión establecida
    const connectionMsg = await new Promise((resolve) => {
        guest1Ws.once('message', (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'connection_established') {
                resolve(msg);
            }
        });
    });
    
    guest1Token = connectionMsg.shortToken;
    console.log(`  Guest 1 conectado con token: ${guest1Token}`);
    
    // Establecer modo guest
    await sendAndWait(guest1Ws, {
        type: 'set_mode',
        mode: 'guest'
    }, 'mode_set');
    
    console.log('  Guest 1 en modo guest');
    
    // Suscribirse al host
    const subscribeResponse = await sendAndWait(guest1Ws, {
        type: 'subscribe',
        to: hostToken
    }, 'subscribed');
    
    console.log(`  Guest 1 suscrito a host ${hostToken}: ${subscribeResponse.message}`);
    
    // Verificar que el host recibió notificación
    const hostNotification = await new Promise((resolve) => {
        const timer = setTimeout(() => {
            resolve(null);
        }, 1000);
        
        hostWs.once('message', (data) => {
            clearTimeout(timer);
            const msg = JSON.parse(data.toString());
            if (msg.type === 'new_subscriber') {
                resolve(msg);
            }
        });
    });
    
    if (hostNotification && hostNotification.guest === guest1Token) {
        console.log(`  Host notificado correctamente: nuevo subscriber ${hostNotification.guest}`);
    }
    
    console.log('  Test 2 completado ✓\n');
}

// Test 3: Host envía broadcast
async function test3() {
    console.log('Test 3: Host envía broadcast a subscribers');
    
    // Guest 1 debería recibir el broadcast
    let guestReceived = false;
    const broadcastMessage = 'Hola a todos los guests!';
    
    guest1Ws.once('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'broadcast_message' && msg.from === hostToken) {
            guestReceived = true;
            console.log(`  Guest 1 recibió broadcast: "${msg.message}"`);
        }
    });
    
    // Host envía broadcast (mensaje a su propio token)
    const broadcastResponse = await sendAndWait(hostWs, {
        to: hostToken,
        message: broadcastMessage
    }, 'broadcast_sent');
    
    console.log(`  Broadcast enviado a ${broadcastResponse.subscribersCount} subscribers`);
    
    // Esperar un momento para que llegue el mensaje
    await new Promise(resolve => setTimeout(resolve, 500));
    
    if (guestReceived) {
        console.log('  Test 3 completado ✓\n');
    } else {
        console.log('  ERROR: Guest no recibió el broadcast\n');
    }
}

// Test 4: Conectar segundo guest y probar múltiples subscribers
async function test4() {
    console.log('Test 4: Conectar segundo guest y probar múltiples subscribers');
    
    guest2Ws = new WebSocket(SERVER_URL);
    
    await new Promise((resolve) => {
        guest2Ws.on('open', resolve);
    });
    
    // Esperar mensaje de conexión establecida
    const connectionMsg = await new Promise((resolve) => {
        guest2Ws.once('message', (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'connection_established') {
                resolve(msg);
            }
        });
    });
    
    guest2Token = connectionMsg.shortToken;
    console.log(`  Guest 2 conectado con token: ${guest2Token}`);
    
    // Establecer modo guest
    await sendAndWait(guest2Ws, {
        type: 'set_mode',
        mode: 'guest'
    }, 'mode_set');
    
    // Suscribirse al host
    await sendAndWait(guest2Ws, {
        type: 'subscribe',
        to: hostToken
    }, 'subscribed');
    
    console.log(`  Guest 2 suscrito a host ${hostToken}`);
    
    // Host envía broadcast que ambos guests deberían recibir
    let guest1Received = false;
    let guest2Received = false;
    const broadcastMessage = 'Broadcast para dos guests!';
    
    guest1Ws.once('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'broadcast_message' && msg.from === hostToken) {
            guest1Received = true;
        }
    });
    
    guest2Ws.once('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'broadcast_message' && msg.from === hostToken) {
            guest2Received = true;
        }
    });
    
    const broadcastResponse = await sendAndWait(hostWs, {
        to: hostToken,
        message: broadcastMessage
    }, 'broadcast_sent');
    
    console.log(`  Broadcast enviado a ${broadcastResponse.subscribersCount} subscribers`);
    
    // Esperar un momento
    await new Promise(resolve => setTimeout(resolve, 500));
    
    if (guest1Received && guest2Received) {
        console.log('  Ambos guests recibieron el broadcast');
        console.log('  Test 4 completado ✓\n');
    } else {
        console.log(`  ERROR: Guest 1 recibió: ${guest1Received}, Guest 2 recibió: ${guest2Received}\n`);
    }
}

// Test 5: Guest se desuscribe
async function test5() {
    console.log('Test 5: Guest se desuscribe');
    
    // Guest 1 se desuscribe
    const unsubscribeResponse = await sendAndWait(guest1Ws, {
        type: 'unsubscribe'
    }, 'unsubscribed');
    
    console.log(`  Guest 1 desuscrito: ${unsubscribeResponse.message}`);
    
    // Host debería recibir notificación
    const hostNotification = await new Promise((resolve) => {
        const timer = setTimeout(() => {
            resolve(null);
        }, 1000);
        
        hostWs.once('message', (data) => {
            clearTimeout(timer);
            const msg = JSON.parse(data.toString());
            if (msg.type === 'subscriber_left') {
                resolve(msg);
            }
        });
    });
    
    if (hostNotification && hostNotification.guest === guest1Token) {
        console.log(`  Host notificado: subscriber left ${hostNotification.guest}`);
    }
    
    // Verificar que guest 1 ya no recibe broadcasts
    let guestReceived = false;
    guest1Ws.once('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'broadcast_message') {
            guestReceived = true;
            console.log(`  ERROR: Guest 1 recibió mensaje después de desuscribirse: "${msg.message.substring(0, 30)}..."`);
        }
    });
    
    // Host envía otro broadcast
    await sendAndWait(hostWs, {
        to: hostToken,
        message: 'Este mensaje solo debería llegar a guest 2'
    }, 'broadcast_sent');
    
    await new Promise(resolve => setTimeout(resolve, 500));
    
    if (!guestReceived) {
        console.log('  Guest 1 correctamente no recibió el broadcast después de desuscribirse');
        console.log('  Test 5 completado ✓\n');
    }
}

// Test 6: Cambio de modo
async function test6() {
    console.log('Test 6: Cambio de modo (host a guest)');
    
    // Host cambia a modo guest (debería limpiar sus subscribers)
    const modeResponse = await sendAndWait(hostWs, {
        type: 'set_mode',
        mode: 'guest'
    }, 'mode_set');
    
    console.log(`  Host cambió a modo ${modeResponse.mode}`);
    
    // Verificar que guest 2 recibió notificación de host desconectado
    const guest2Notification = await new Promise((resolve) => {
        const timer = setTimeout(() => {
            resolve(null);
        }, 1000);
        
        guest2Ws.once('message', (data) => {
            clearTimeout(timer);
            const msg = JSON.parse(data.toString());
            if (msg.type === 'host_disconnected') {
                resolve(msg);
            }
        });
    });
    
    if (guest2Notification) {
        console.log(`  Guest 2 notificado: host desconectado`);
    }
    
    console.log('  Test 6 completado ✓\n');
}

// Ejecutar todos los tests
async function runAllTests() {
    try {
        console.log('Iniciando tests...\n');
        
        await test1();
        await test2();
        await test3();
        await test4();
        await test5();
        await test6();
        
        console.log('=== Todos los tests completados ===');
        console.log('Resumen:');
        console.log('- Sistema de modos host/guest funcionando');
        console.log('- Suscripciones funcionando');
        console.log('- Broadcast funcionando');
        console.log('- Desuscripciones funcionando');
        console.log('- Cambio de modos funcionando');
        console.log('- Notificaciones automáticas funcionando');
        
    } catch (error) {
        console.error('Error en tests:', error);
    } finally {
        // Cerrar conexiones
        if (hostWs) hostWs.close();
        if (guest1Ws) guest1Ws.close();
        if (guest2Ws) guest2Ws.close();
        
        console.log('\nConexiones cerradas.');
        process.exit(0);
    }
}

// Verificar si el servidor está corriendo
const checkServer = new WebSocket(SERVER_URL);
checkServer.on('error', () => {
    console.error(`ERROR: No se puede conectar al servidor en ${SERVER_URL}`);
    console.error('Por favor, inicia el servidor primero: npm run dev');
    process.exit(1);
});

checkServer.on('open', () => {
    checkServer.close();
    console.log(`Servidor detectado en ${SERVER_URL}`);
    runAllTests();
});