// Token Manager para el sistema de tokens alfanuméricos
// Caracteres permitidos: 1-9, A-Z (sin 0 ni letras minúsculas)
const ALLOWED_CHARS = '123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

class TokenManager {
    constructor() {
        // Mapa de tokens activos: token -> {uuid, ip, lastActivity}
        this.activeTokens = new Map();
        // Mapa de tokens liberados por tiempo: token -> timestamp de liberación
        this.releasedTokens = new Map();
        // Longitud actual de los tokens
        this.currentTokenLength = 4;
        // Tiempo de expiración en milisegundos (10 minutos)
        this.expirationTime = 10 * 60 * 1000;
        // Limpiar tokens expirados periódicamente
        this.startCleanupInterval();
    }

    // Generar un token aleatorio de la longitud especificada
    generateRandomToken(length) {
        let token = '';
        for (let i = 0; i < length; i++) {
            const randomIndex = Math.floor(Math.random() * ALLOWED_CHARS.length);
            token += ALLOWED_CHARS[randomIndex];
        }
        return token;
    }

    // Verificar si un token ya está en uso (activo o recientemente liberado)
    isTokenInUse(token) {
        return this.activeTokens.has(token) || this.releasedTokens.has(token);
    }

    // Generar un token único
    generateUniqueToken() {
        let attempts = 0;
        const maxAttempts = 100;
        
        while (attempts < maxAttempts) {
            const token = this.generateRandomToken(this.currentTokenLength);
            
            if (!this.isTokenInUse(token)) {
                return token;
            }
            
            attempts++;
        }
        
        // Si no se encontró token único con la longitud actual, aumentar longitud
        this.currentTokenLength++;
        console.log(`Aumentando longitud de token a ${this.currentTokenLength} caracteres`);
        
        // Intentar con la nueva longitud
        return this.generateRandomToken(this.currentTokenLength);
    }

    // Asignar un token a una conexión
    assignToken(uuid, ip) {
        const token = this.generateUniqueToken();
        const now = Date.now();
        
        this.activeTokens.set(token, {
            uuid,
            ip,
            lastActivity: now,
            assignedAt: now
        });
        
        // Si el token estaba en releasedTokens, eliminarlo
        this.releasedTokens.delete(token);
        
        return token;
    }

    // Obtener información de un token activo
    getTokenInfo(token) {
        return this.activeTokens.get(token);
    }

    // Verificar si un token es válido para una IP
    isValidTokenForIp(token, ip) {
        const tokenInfo = this.activeTokens.get(token);
        if (!tokenInfo) {
            return false;
        }
        
        // Verificar que la IP coincida
        return tokenInfo.ip === ip;
    }

    // Actualizar la última actividad de un token
    updateTokenActivity(token) {
        const tokenInfo = this.activeTokens.get(token);
        if (tokenInfo) {
            tokenInfo.lastActivity = Date.now();
            return true;
        }
        return false;
    }

    // Liberar un token (cuando se desconecta)
    releaseToken(token) {
        const tokenInfo = this.activeTokens.get(token);
        if (tokenInfo) {
            this.activeTokens.delete(token);
            // Marcar como liberado con timestamp
            this.releasedTokens.set(token, Date.now());
            return true;
        }
        return false;
    }

    // Liberar token por UUID
    releaseTokenByUuid(uuid) {
        for (const [token, info] of this.activeTokens) {
            if (info.uuid === uuid) {
                this.releaseToken(token);
                return token;
            }
        }
        return null;
    }

    // Limpiar tokens liberados que han expirado (más de 10 minutos)
    cleanupExpiredTokens() {
        const now = Date.now();
        const expiredTokens = [];
        
        for (const [token, releaseTime] of this.releasedTokens) {
            if (now - releaseTime > this.expirationTime) {
                expiredTokens.push(token);
            }
        }
        
        // Eliminar tokens expirados
        expiredTokens.forEach(token => {
            this.releasedTokens.delete(token);
        });
        
        if (expiredTokens.length > 0) {
            console.log(`Limpiados ${expiredTokens.length} tokens expirados: ${expiredTokens.join(', ')}`);
        }
        
        // También limpiar tokens activos inactivos (por si acaso)
        this.cleanupInactiveTokens();
    }

    // Limpiar tokens activos inactivos (más de 10 minutos sin actividad)
    cleanupInactiveTokens() {
        const now = Date.now();
        const inactiveTokens = [];
        
        for (const [token, info] of this.activeTokens) {
            if (now - info.lastActivity > this.expirationTime) {
                inactiveTokens.push(token);
            }
        }
        
        // Liberar tokens inactivos
        inactiveTokens.forEach(token => {
            console.log(`Liberando token inactivo: ${token} (última actividad hace ${Math.floor((now - this.activeTokens.get(token).lastActivity) / 60000)} minutos)`);
            this.releaseToken(token);
        });
    }

    // Iniciar intervalo de limpieza periódica
    startCleanupInterval() {
        // Limpiar cada minuto
        setInterval(() => {
            this.cleanupExpiredTokens();
        }, 60 * 1000);
    }

    // Obtener estadísticas
    getStats() {
        return {
            activeTokens: this.activeTokens.size,
            releasedTokens: this.releasedTokens.size,
            currentTokenLength: this.currentTokenLength,
            expirationTimeMinutes: this.expirationTime / 60000
        };
    }

    // Obtener todos los tokens activos
    getAllActiveTokens() {
        const result = {};
        for (const [token, info] of this.activeTokens) {
            result[token] = {
                uuid: info.uuid,
                ip: info.ip,
                lastActivity: new Date(info.lastActivity).toISOString(),
                assignedAt: new Date(info.assignedAt).toISOString(),
                inactiveForMinutes: Math.floor((Date.now() - info.lastActivity) / 60000)
            };
        }
        return result;
    }
}

module.exports = new TokenManager();