const express = require('express');
const cors = require('cors');
const axios = require('axios');
const CircuitBreaker = require('opossum');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const pino = require('pino');
const { v4: uuidv4 } = require('uuid');

const logger = pino({ 
    level: process.env.LOG_LEVEL || 'info',
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname'
        }
    }
});

const app = express();
const PORT = process.env.PORT || 8000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Middleware
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true
}));
app.use(express.json());

// Request ID and logging middleware
app.use((req, res, next) => {
    req.id = req.headers['x-request-id'] || uuidv4();
    res.setHeader('X-Request-ID', req.id);
    
    logger.info({
        requestId: req.id,
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.headers['user-agent']
    }, 'Incoming request');
    
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info({
            requestId: req.id,
            method: req.method,
            url: req.url,
            statusCode: res.statusCode,
            duration: `${duration}ms`
        }, 'Request completed');
    });
    
    next();
});

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 минут
    max: 100, // максимум 100 запросов с одного IP
    message: { 
        success: false, 
        error: { 
            code: 'RATE_LIMIT_EXCEEDED', 
            message: 'Слишком много запросов. Попробуйте позже.' 
        } 
    },
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/v1', limiter);

// Service URLs
const USERS_SERVICE_URL = process.env.USERS_SERVICE_URL || 'http://service_users:8000';
const ORDERS_SERVICE_URL = process.env.ORDERS_SERVICE_URL || 'http://service_orders:8000';

// Circuit Breaker configuration
const circuitOptions = {
    timeout: 5000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
};

// JWT verification middleware
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        logger.warn({ requestId: req.id }, 'Missing or invalid authorization header');
        return res.status(401).json({ 
            success: false, 
            error: { 
                code: 'UNAUTHORIZED', 
                message: 'Токен не предоставлен' 
            } 
        });
    }

    const token = authHeader.substring(7);
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        logger.info({ requestId: req.id, userId: decoded.userId }, 'User authenticated');
        next();
    } catch (error) {
        logger.error({ requestId: req.id, error: error.message }, 'JWT verification failed');
        return res.status(401).json({ 
            success: false, 
            error: { 
                code: 'INVALID_TOKEN', 
                message: 'Недействительный или истекший токен' 
            } 
        });
    }
};

// Role check middleware
const requireRole = (...roles) => {
    return (req, res, next) => {
        if (!req.user || !req.user.roles) {
            return res.status(403).json({ 
                success: false, 
                error: { 
                    code: 'FORBIDDEN', 
                    message: 'Недостаточно прав' 
                } 
            });
        }

        const hasRole = roles.some(role => req.user.roles.includes(role));
        if (!hasRole) {
            logger.warn({ 
                requestId: req.id, 
                userId: req.user.userId, 
                requiredRoles: roles,
                userRoles: req.user.roles
            }, 'Access denied - insufficient permissions');
            
            return res.status(403).json({ 
                success: false, 
                error: { 
                    code: 'FORBIDDEN', 
                    message: 'Недостаточно прав для выполнения этой операции' 
                } 
            });
        }

        next();
    };
};

// Create circuit breakers
const createCircuitBreaker = (serviceName) => {
    const breaker = new CircuitBreaker(async (url, options = {}) => {
        try {
            const response = await axios({
                url,
                ...options,
                timeout: 5000,
                headers: {
                    ...options.headers,
                    'X-Request-ID': options.requestId,
                    'Content-Type': 'application/json'
                }
            });
            return { status: response.status, data: response.data };
        } catch (error) {
            if (error.response) {
                return { status: error.response.status, data: error.response.data };
            }
            throw error;
        }
    }, circuitOptions);

    breaker.fallback(() => ({
        status: 503,
        data: {
            success: false,
            error: {
                code: 'SERVICE_UNAVAILABLE',
                message: `Сервис ${serviceName} временно недоступен`
            }
        }
    }));

    breaker.on('open', () => logger.warn(`Circuit breaker opened for ${serviceName}`));
    breaker.on('close', () => logger.info(`Circuit breaker closed for ${serviceName}`));
    breaker.on('halfOpen', () => logger.info(`Circuit breaker half-open for ${serviceName}`));

    return breaker;
};

const usersCircuit = createCircuitBreaker('users');
const ordersCircuit = createCircuitBreaker('orders');

// Proxy helper function
const proxyRequest = async (circuit, url, options, res, requestId) => {
    try {
        const result = await circuit.fire(url, { ...options, requestId });
        return res.status(result.status).json(result.data);
    } catch (error) {
        logger.error({ requestId, error: error.message }, 'Proxy request failed');
        return res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Внутренняя ошибка сервера'
            }
        });
    }
};

// ============ USERS ROUTES ============

// POST /api/v1/users/register - Регистрация (публичный)
app.post('/api/v1/users/register', async (req, res) => {
    logger.info({ requestId: req.id, body: req.body }, 'Registration request');
    await proxyRequest(
        usersCircuit,
        `${USERS_SERVICE_URL}/api/v1/users/register`,
        { method: 'POST', data: req.body },
        res,
        req.id
    );
});

// POST /api/v1/users/login - Вход (публичный)
app.post('/api/v1/users/login', async (req, res) => {
    logger.info({ requestId: req.id, email: req.body.email }, 'Login request');
    await proxyRequest(
        usersCircuit,
        `${USERS_SERVICE_URL}/api/v1/users/login`,
        { method: 'POST', data: req.body },
        res,
        req.id
    );
});

// GET /api/v1/users/profile - Получение профиля (защищенный)
app.get('/api/v1/users/profile', authMiddleware, async (req, res) => {
    await proxyRequest(
        usersCircuit,
        `${USERS_SERVICE_URL}/api/v1/users/profile`,
        { 
            method: 'GET',
            headers: {
                'X-User-ID': req.user.userId,
                'X-User-Roles': JSON.stringify(req.user.roles)
            }
        },
        res,
        req.id
    );
});

// PUT /api/v1/users/profile - Обновление профиля (защищенный)
app.put('/api/v1/users/profile', authMiddleware, async (req, res) => {
    await proxyRequest(
        usersCircuit,
        `${USERS_SERVICE_URL}/api/v1/users/profile`,
        { 
            method: 'PUT',
            data: req.body,
            headers: {
                'X-User-ID': req.user.userId,
                'X-User-Roles': JSON.stringify(req.user.roles)
            }
        },
        res,
        req.id
    );
});

// GET /api/v1/users - Список пользователей (только admin)
app.get('/api/v1/users', authMiddleware, requireRole('admin'), async (req, res) => {
    const queryString = new URLSearchParams(req.query).toString();
    await proxyRequest(
        usersCircuit,
        `${USERS_SERVICE_URL}/api/v1/users?${queryString}`,
        { 
            method: 'GET',
            headers: {
                'X-User-ID': req.user.userId,
                'X-User-Roles': JSON.stringify(req.user.roles)
            }
        },
        res,
        req.id
    );
});

// ============ ORDERS ROUTES ============

// POST /api/v1/orders - Создание заказа (защищенный)
app.post('/api/v1/orders', authMiddleware, async (req, res) => {
    logger.info({ requestId: req.id, userId: req.user.userId }, 'Create order request');
    await proxyRequest(
        ordersCircuit,
        `${ORDERS_SERVICE_URL}/api/v1/orders`,
        { 
            method: 'POST',
            data: req.body,
            headers: {
                'X-User-ID': req.user.userId,
                'X-User-Roles': JSON.stringify(req.user.roles)
            }
        },
        res,
        req.id
    );
});

// GET /api/v1/orders - Список заказов (защищенный)
app.get('/api/v1/orders', authMiddleware, async (req, res) => {
    const queryString = new URLSearchParams(req.query).toString();
    await proxyRequest(
        ordersCircuit,
        `${ORDERS_SERVICE_URL}/api/v1/orders?${queryString}`,
        { 
            method: 'GET',
            headers: {
                'X-User-ID': req.user.userId,
                'X-User-Roles': JSON.stringify(req.user.roles)
            }
        },
        res,
        req.id
    );
});

// GET /api/v1/orders/:id - Получение заказа (защищенный)
app.get('/api/v1/orders/:id', authMiddleware, async (req, res) => {
    await proxyRequest(
        ordersCircuit,
        `${ORDERS_SERVICE_URL}/api/v1/orders/${req.params.id}`,
        { 
            method: 'GET',
            headers: {
                'X-User-ID': req.user.userId,
                'X-User-Roles': JSON.stringify(req.user.roles)
            }
        },
        res,
        req.id
    );
});

// PATCH /api/v1/orders/:id/status - Обновление статуса (защищенный)
app.patch('/api/v1/orders/:id/status', authMiddleware, async (req, res) => {
    await proxyRequest(
        ordersCircuit,
        `${ORDERS_SERVICE_URL}/api/v1/orders/${req.params.id}/status`,
        { 
            method: 'PATCH',
            data: req.body,
            headers: {
                'X-User-ID': req.user.userId,
                'X-User-Roles': JSON.stringify(req.user.roles)
            }
        },
        res,
        req.id
    );
});

// DELETE /api/v1/orders/:id - Отмена заказа (защищенный)
app.delete('/api/v1/orders/:id', authMiddleware, async (req, res) => {
    await proxyRequest(
        ordersCircuit,
        `${ORDERS_SERVICE_URL}/api/v1/orders/${req.params.id}`,
        { 
            method: 'DELETE',
            headers: {
                'X-User-ID': req.user.userId,
                'X-User-Roles': JSON.stringify(req.user.roles)
            }
        },
        res,
        req.id
    );
});

// ============ AGGREGATION ROUTE ============

// GET /api/v1/users/:userId/details - Детали пользователя с заказами
app.get('/api/v1/users/:userId/details', authMiddleware, async (req, res) => {
    try {
        const userId = req.params.userId;

        // Проверка прав: только сам пользователь или admin
        if (req.user.userId !== userId && !req.user.roles.includes('admin')) {
            return res.status(403).json({
                success: false,
                error: { code: 'FORBIDDEN', message: 'Недостаточно прав' }
            });
        }

        const [userResult, ordersResult] = await Promise.all([
            usersCircuit.fire(`${USERS_SERVICE_URL}/api/v1/users/profile`, {
                method: 'GET',
                headers: {
                    'X-User-ID': userId,
                    'X-User-Roles': JSON.stringify(['user'])
                },
                requestId: req.id
            }),
            ordersCircuit.fire(`${ORDERS_SERVICE_URL}/api/v1/orders`, {
                method: 'GET',
                headers: {
                    'X-User-ID': userId,
                    'X-User-Roles': JSON.stringify(['user'])
                },
                requestId: req.id
            })
        ]);

        if (userResult.status !== 200) {
            return res.status(userResult.status).json(userResult.data);
        }

        res.json({
            success: true,
            data: {
                user: userResult.data.data,
                orders: ordersResult.status === 200 ? ordersResult.data.data.orders : []
            }
        });
    } catch (error) {
        logger.error({ requestId: req.id, error: error.message }, 'Aggregation request failed');
        res.status(500).json({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Внутренняя ошибка сервера' }
        });
    }
});

// ============ HEALTH & STATUS ENDPOINTS ============

app.get('/health', (req, res) => {
    res.json({
        success: true,
        data: {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            circuits: {
                users: {
                    state: usersCircuit.opened ? 'open' : usersCircuit.halfOpen ? 'half-open' : 'closed',
                    stats: usersCircuit.stats
                },
                orders: {
                    state: ordersCircuit.opened ? 'open' : ordersCircuit.halfOpen ? 'half-open' : 'closed',
                    stats: ordersCircuit.stats
                }
            }
        }
    });
});

app.get('/status', (req, res) => {
    res.json({
        success: true,
        data: {
            service: 'API Gateway',
            version: '1.0.0',
            environment: process.env.NODE_ENV || 'development',
            uptime: process.uptime()
        }
    });
});

// 404 handler
app.use((req, res) => {
    logger.warn({ requestId: req.id, url: req.url }, 'Route not found');
    res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Маршрут не найден' }
    });
});

// Error handler
app.use((err, req, res, next) => {
    logger.error({ requestId: req.id, error: err.message, stack: err.stack }, 'Unhandled error');
    res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: 'Внутренняя ошибка сервера' }
    });
});

// Start server
app.listen(PORT, () => {
    logger.info({
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        usersService: USERS_SERVICE_URL,
        ordersService: ORDERS_SERVICE_URL
    }, 'API Gateway started');
});

module.exports = app;