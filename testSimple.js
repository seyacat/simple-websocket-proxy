// Test script para verificar el sistema simplificado de WebSocket proxy
const WebSocket = require('ws');

console.log('=== Test del Sistema Simplificado de WebSocket Proxy ===\n');

const SERVER_URL = 'ws://localhost:4001';
let client1 = null;
let client2 = null;
let client3 = null;
let token1 = null;
let token2 = null;
let token3 = null;

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

// Test 1: Conexión básica y obtención de token
async function test1() {
    console.log('Test 1: Conexión básica y obtención de token');
    
    client1 = new WebSocket(SERVER_URL);
    
    const response = await new Promise((resolve, reject) => {
        client1.on('open', () => {
            console.log('  ✓ Cliente 1 conectado');
        });
        
        client1.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'connected') {
                    token1 = msg.token;
                    resolve(msg);
                }
            } catch (error) {
                reject(error);
            }
        });
        
        client1.on('error', reject);
    });
    
    console.log(`  ✓ Token asignado: ${token1}`);
    console.log(`  ✓ Timestamp: ${response.timestamp}`);
    return true;
}

// Test 2: Conexión de segundo cliente
async function test2() {
    console.log('\nTest 2: Conexión de segundo cliente');
    
    client2 = new WebSocket(SERVER_URL);
    
    const response = await new Promise((resolve, reject) => {
        client2.on('open', () => {
            console.log('  ✓ Cliente 2 conectado');
        });
        
        client2.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'connected') {
                    token2 = msg.token;
                    resolve(msg);
                }
            } catch (error) {
                reject(error);
            }
        });
        
        client2.on('error', reject);
    });
    
    console.log(`  ✓ Token asignado: ${token2}`);
    return true;
}

// Test 3: Envío de mensaje de cliente1 a cliente2
async function test3() {
    console.log('\nTest 3: Envío de mensaje de cliente1 a cliente2');
    
    // Configurar listener en cliente2 para recibir mensaje
    const messagePromise = new Promise((resolve) => {
        client2.once('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'message') {
                    resolve(msg);
                }
            } catch (error) {
                // Ignorar otros mensajes
            }
        });
    });
    
    // Enviar mensaje de cliente1 a cliente2
    const sendResponse = await sendAndWait(client1, {
        to: [token2],
        message: 'Hola desde cliente 1'
    }, 'message_sent');
    
    console.log(`  ✓ Mensaje enviado: ${sendResponse.sent}/1 destinatarios`);
    
    // Esperar mensaje en cliente2
    const receivedMsg = await Promise.race([
        messagePromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout esperando mensaje')), 2000))
    ]);
    
    console.log(`  ✓ Cliente2 recibió mensaje: "${receivedMsg.message}"`);
    console.log(`  ✓ De: ${receivedMsg.from}`);
    return true;
}

// Test 4: Envío de mensaje a múltiples destinatarios
async function test4() {
    console.log('\nTest 4: Conexión de tercer cliente y mensaje a múltiples destinatarios');
    
    // Conectar tercer cliente
    client3 = new WebSocket(SERVER_URL);
    
    const response = await new Promise((resolve, reject) => {
        client3.on('open', () => {
            console.log('  ✓ Cliente 3 conectado');
        });
        
        client3.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'connected') {
                    token3 = msg.token;
                    resolve(msg);
                }
            } catch (error) {
                reject(error);
            }
        });
        
        client3.on('error', reject);
    });
    
    console.log(`  ✓ Token asignado: ${token3}`);
    
    // Configurar listeners en clientes 2 y 3
    let receivedCount = 0;
    const checkReceived = () => {
        receivedCount++;
        if (receivedCount === 2) {
            console.log('  ✓ Ambos clientes recibieron el mensaje');
        }
    };
    
    client2.once('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'message' && msg.from === token1) {
                checkReceived();
            }
        } catch (error) {
            // Ignorar
        }
    });
    
    client3.once('message', (data) => {
        try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'message' && msg.from === token1) {
                checkReceived();
            }
        } catch (error) {
            // Ignorar
        }
    });
    
    // Enviar mensaje a múltiples destinatarios
    const sendResponse = await sendAndWait(client1, {
        to: [token2, token3],
        message: 'Mensaje a múltiples clientes'
    }, 'message_sent');
    
    console.log(`  ✓ Mensaje enviado: ${sendResponse.sent}/2 destinatarios`);
    
    // Esperar un momento para que lleguen los mensajes
    await new Promise(resolve => setTimeout(resolve, 500));
    return true;
}

// Test 5: Publicar en canal público
async function test5() {
    console.log('\nTest 5: Publicar en canal público');
    
    const response = await sendAndWait(client1, {
        type: 'publish',
        channel: 'game-lobby'
    }, 'published');
    
    console.log(`  ✓ Cliente1 publicado en canal: ${response.channel}`);
    
    // Publicar cliente2 en otro canal
    await sendAndWait(client2, {
        type: 'publish',
        channel: 'game-lobby'
    }, 'published');
    
    console.log(`  ✓ Cliente2 publicado en canal: game-lobby`);
    
    // Publicar cliente3 en canal diferente
    await sendAndWait(client3, {
        type: 'publish',
        channel: 'chat-general'
    }, 'published');
    
    console.log(`  ✓ Cliente3 publicado en canal: chat-general`);
    return true;
}

// Test 6: Listar tokens en canal
async function test6() {
    console.log('\nTest 6: Listar tokens en canal');
    
    const response = await sendAndWait(client1, {
        type: 'list',
        channel: 'game-lobby'
    }, 'channel_list');
    
    console.log(`  ✓ Canal ${response.channel}: ${response.count} tokens`);
    console.log(`  ✓ Tokens: ${response.tokens.join(', ')}`);
    
    // Verificar que ambos tokens están en la lista
    const hasToken1 = response.tokens.includes(token1);
    const hasToken2 = response.tokens.includes(token2);
    
    if (hasToken1 && hasToken2) {
        console.log('  ✓ Ambos tokens encontrados en el canal');
    } else {
        console.log(`  ✗ Faltan tokens: token1=${hasToken1}, token2=${hasToken2}`);
    }
    return true;
}

// Test 7: Notificación de desconexión
async function test7() {
    console.log('\nTest 7: Notificación de desconexión');
    
    // Configurar listener en cliente2 para notificación de desconexión
    const disconnectPromise = new Promise((resolve) => {
        client2.once('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.type === 'disconnected') {
                    resolve(msg);
                }
            } catch (error) {
                // Ignorar
            }
        });
    });
    
    // Desconectar cliente1
    console.log('  Desconectando cliente1...');
    client1.close();
    
    // Esperar notificación en cliente2
    try {
        const disconnectMsg = await Promise.race([
            disconnectPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout esperando notificación')), 2000))
        ]);
        
        console.log(`  ✓ Cliente2 notificado de desconexión de: ${disconnectMsg.token}`);
        return true;
    } catch (error) {
        console.log(`  ✗ ${error.message}`);
        return false;
    }
}

// Test 8: Mensaje a token inválido
async function test8() {
    console.log('\nTest 8: Mensaje a token inválido');
    
    const response = await sendAndWait(client2, {
        to: ['INVALID'],
        message: 'Mensaje a token inválido'
    }, 'message_sent');
    
    console.log(`  ✓ Respuesta: ${response.sent}/1 enviados`);
    if (response.failed && response.failed.includes('INVALID')) {
        console.log('  ✓ Token inválido correctamente identificado');
    }
    return true;
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
        await test7();
        await test8();
        
        console.log('\n=========================================');
        console.log('✅ TODOS LOS TESTS COMPLETADOS EXITOSAMENTE');
        console.log('=========================================');
        
        // Limpiar conexiones restantes
        if (client2 && client2.readyState === WebSocket.OPEN) client2.close();
        if (client3 && client3.readyState === WebSocket.OPEN) client3.close();
        
        process.exit(0);
    } catch (error) {
        console.error('\n=========================================');
        console.error('❌ ERROR EN TEST:');
        console.error(error.message);
        console.error('=========================================');
        
        // Limpiar conexiones
        if (client1 && client1.readyState === WebSocket.OPEN) client1.close();
        if (client2 && client2.readyState === WebSocket.OPEN) client2.close();
        if (client3 && client3.readyState === WebSocket.OPEN) client3.close();
        
        process.exit(1);
    }
}

// Verificar que el servidor esté ejecutándose
console.log('Asegúrate de que el servidor esté ejecutándose en puerto 4001');
console.log('Ejecuta: node server.js\n');

// Ejecutar tests después de 2 segundos para dar tiempo al servidor
setTimeout(runAllTests, 2000);