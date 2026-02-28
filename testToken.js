// Test script para verificar el sistema de tokens cortos
const tokenManager = require('./tokenManager');

console.log('=== Test del Sistema de Tokens Cortos ===\n');

// Test 1: Generar tokens cortos únicos
console.log('Test 1: Generar tokens cortos únicos');
const tokens = new Set();
for (let i = 0; i < 10; i++) {
    const token = tokenManager.generateUniqueShortToken();
    tokens.add(token);
    console.log(`  Token corto ${i + 1}: ${token} (longitud: ${token.length})`);
    // Verificar formato
    if (!/^[1-9A-Z]+$/.test(token)) {
        console.log(`    ERROR: Token contiene caracteres inválidos!`);
    }
}
console.log(`  Tokens cortos únicos generados: ${tokens.size}/10\n`);

// Test 2: Asignar tokens cortos a UUIDs
console.log('Test 2: Asignar tokens cortos a UUIDs');
const uuid1 = 'test-uuid-1-' + Date.now();
const uuid2 = 'test-uuid-2-' + Date.now();
const ip1 = '192.168.1.100';
const ip2 = '192.168.1.101';

const shortToken1 = tokenManager.assignShortToken(uuid1, ip1);
const shortToken2 = tokenManager.assignShortToken(uuid2, ip2);

console.log(`  UUID1: ${uuid1} -> Token corto: ${shortToken1}`);
console.log(`  UUID2: ${uuid2} -> Token corto: ${shortToken2}`);

// Test 3: Verificar mapeos inversos
console.log('\nTest 3: Verificar mapeos inversos');
console.log(`  Token -> UUID para ${shortToken1}: ${tokenManager.getUuidByShortToken(shortToken1)}`);
console.log(`  UUID -> Token para ${uuid2}: ${tokenManager.getShortTokenByUuid(uuid2)}`);

// Test 4: Validación de tokens
console.log('\nTest 4: Validación de tokens');
console.log(`  Token ${shortToken1} válido para IP ${ip1}: ${tokenManager.isValidShortTokenForIp(shortToken1, ip1)}`);
console.log(`  Token ${shortToken1} válido para IP diferente: ${tokenManager.isValidShortTokenForIp(shortToken1, '10.0.0.1')}`);

// Test 5: Liberar y recuperar tokens
console.log('\nTest 5: Liberar y recuperar tokens');
tokenManager.releaseShortToken(shortToken1);
console.log(`  Token ${shortToken1} liberado`);
console.log(`  Token aún activo después de liberar: ${tokenManager.getShortTokenInfo(shortToken1) !== undefined}`);
console.log(`  UUID -> Token después de liberar: ${tokenManager.getShortTokenByUuid(uuid1)}`);

// Test 6: Reconexión (asignar nuevo token al mismo UUID)
console.log('\nTest 6: Reconexión con mismo UUID');
const newShortToken1 = tokenManager.assignShortToken(uuid1, ip1);
console.log(`  Nuevo token para UUID1: ${newShortToken1}`);
console.log(`  Es diferente al anterior: ${newShortToken1 !== shortToken1}`);

// Test 7: Estadísticas
console.log('\nTest 7: Estadísticas del sistema');
const stats = tokenManager.getStats();
console.log('  Estadísticas:', stats);

// Test 8: Tokens activos
console.log('\nTest 8: Lista de tokens activos');
const activeTokens = tokenManager.getAllActiveShortTokens();
console.log(`  Tokens activos: ${Object.keys(activeTokens).length}`);
for (const [token, info] of Object.entries(activeTokens)) {
    console.log(`    ${token} -> UUID: ${info.uuid.substring(0, 20)}..., IP: ${info.ip}`);
}

// Test 9: Simular aumento de longitud cuando se acaban tokens únicos
console.log('\nTest 9: Simular colisión de tokens (forzar aumento de longitud)');
// Nota: En la práctica, esto ocurriría automáticamente cuando generateUniqueShortToken()
// no pueda encontrar un token único después de 100 intentos
console.log('  Longitud actual de tokens:', tokenManager.currentShortTokenLength);

console.log('\n=== Test completado ===');