const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { z } = require('zod');
const pino = require('pino');

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
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const SALT_ROUNDS = 10;

// Middleware
app.use(express.json());

// In-memory database (в продакшене использовать PostgreSQL/MongoDB)
const users = new Map();

// Создаем тестового админа при старте
const createAdminUser = async () => {
    const adminId = uuidv4();
    const adminUser = {
        id: adminId,
        email: 'admin@test.com',
        passwordHash: await bcrypt.hash('admin123', SALT_ROUNDS),
        name: 'Администратор',
        roles: ['admin', 'user'],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    users.set(adminId, adminUser);
    logger.info({ userId: adminId, email: adminUser.email }, 'Admin user created');
};

// Validation schemas
const registerSchema = z.object({
    email: z.string().email('Некорректный формат email'),
    password: z.string().min(6, 'Пароль должен содержать минимум 6 символов'),
    name: z.string().min(2, 'Имя должно содержать минимум 2 символа').max(100, 'Имя слишком длинное')
});

const loginSchema = z.object({
    email: z.string().email('Некорректный формат email'),
    password: z.string().min(1, 'Пароль обязателен')
});

const updateProfileSchema = z.object({
    name: z.string().min(2, 'Имя должно содержать минимум 2 символа').max(100).optional(),
    email: z.string().email('Некорректный формат email').optional()
});

// Middleware для логирования
app.use((req, res, next) => {
    const requestId = req.headers['x-request-id'] || uuidv4();
    req.id = requestId;
    
    logger.info({
        requestId,
        method: req.method,
        url: req.url,
        userAgent: req.headers['user-agent']
    }, 'Request received');
    
    next();
});

// Middleware для проверки аутентификации
const authMiddleware = (req, res, next) => {
    const userId = req.headers['x-user-id'];
    const roles = req.headers['x-user-roles'];
    
    if (!userId) {
        logger.warn({ requestId: req.id }, 'Unauthorized access attempt');
        return res.status(401).json({ 
            success: false, 
            error: { code: 'UNAUTHORIZED', message: 'Не авторизован' } 
        });
    }
    
    req.userId = userId;
    req.userRoles = roles ? JSON.parse(roles) : [];
    next();
};

// POST /api/v1/users/register - Регистрация
app.post('/api/v1/users/register', async (req, res) => {
    try {
        const validatedData = registerSchema.parse(req.body);
        
        // Проверка существующего пользователя
        const existingUser = Array.from(users.values()).find(u => 
            u.email.toLowerCase() === validatedData.email.toLowerCase()
        );
        
        if (existingUser) {
            logger.warn({ requestId: req.id, email: validatedData.email }, 'Registration failed - email exists');
            return res.status(400).json({ 
                success: false, 
                error: { 
                    code: 'USER_EXISTS', 
                    message: 'Пользователь с таким email уже существует' 
                } 
            });
        }
        
        // Хеширование пароля
        const passwordHash = await bcrypt.hash(validatedData.password, SALT_ROUNDS);
        
        const user = {
            id: uuidv4(),
            email: validatedData.email,
            passwordHash,
            name: validatedData.name,
            roles: ['user'], // По умолчанию роль user
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        users.set(user.id, user);
        
        logger.info({ 
            requestId: req.id, 
            userId: user.id, 
            email: user.email 
        }, 'User registered successfully');
        
        res.status(201).json({ 
            success: true, 
            data: { 
                id: user.id, 
                email: user.email, 
                name: user.name,
                roles: user.roles,
                createdAt: user.createdAt
            } 
        });
    } catch (error) {
        logger.error({ 
            requestId: req.id, 
            error: error.message 
        }, 'Registration error');
        
        if (error instanceof z.ZodError) {
            return res.status(400).json({ 
                success: false, 
                error: { 
                    code: 'VALIDATION_ERROR', 
                    message: error.errors[0].message,
                    details: error.errors
                } 
            });
        }
        
        res.status(500).json({ 
            success: false, 
            error: { 
                code: 'INTERNAL_ERROR', 
                message: 'Внутренняя ошибка сервера' 
            } 
        });
    }
});

// POST /api/v1/users/login - Вход
app.post('/api/v1/users/login', async (req, res) => {
    try {
        const validatedData = loginSchema.parse(req.body);
        
        const user = Array.from(users.values()).find(u => 
            u.email.toLowerCase() === validatedData.email.toLowerCase()
        );
        
        if (!user) {
            logger.warn({ 
                requestId: req.id, 
                email: validatedData.email 
            }, 'Login failed - user not found');
            
            return res.status(401).json({ 
                success: false, 
                error: { 
                    code: 'INVALID_CREDENTIALS', 
                    message: 'Неверный email или пароль' 
                } 
            });
        }
        
        const passwordValid = await bcrypt.compare(validatedData.password, user.passwordHash);
        
        if (!passwordValid) {
            logger.warn({ 
                requestId: req.id, 
                userId: user.id 
            }, 'Login failed - invalid password');
            
            return res.status(401).json({ 
                success: false, 
                error: { 
                    code: 'INVALID_CREDENTIALS', 
                    message: 'Неверный email или пароль' 
                } 
            });
        }
        
        const token = jwt.sign(
            { 
                userId: user.id, 
                email: user.email, 
                roles: user.roles 
            },
            JWT_SECRET,
            { expiresIn: JWT_EXPIRES_IN }
        );
        
        logger.info({ 
            requestId: req.id, 
            userId: user.id 
        }, 'User logged in successfully');
        
        res.json({ 
            success: true, 
            data: { 
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    roles: user.roles
                }
            } 
        });
    } catch (error) {
        logger.error({ 
            requestId: req.id, 
            error: error.message 
        }, 'Login error');
        
        if (error instanceof z.ZodError) {
            return res.status(400).json({ 
                success: false, 
                error: { 
                    code: 'VALIDATION_ERROR', 
                    message: error.errors[0].message 
                } 
            });
        }
        
        res.status(500).json({ 
            success: false, 
            error: { 
                code: 'INTERNAL_ERROR', 
                message: 'Внутренняя ошибка сервера' 
            } 
        });
    }
});

// GET /api/v1/users/profile - Получение профиля
app.get('/api/v1/users/profile', authMiddleware, (req, res) => {
    const user = users.get(req.userId);
    
    if (!user) {
        logger.warn({ requestId: req.id, userId: req.userId }, 'User not found');
        return res.status(404).json({ 
            success: false, 
            error: { 
                code: 'USER_NOT_FOUND', 
                message: 'Пользователь не найден' 
            } 
        });
    }
    
    logger.info({ requestId: req.id, userId: user.id }, 'Profile retrieved');
    
    res.json({ 
        success: true, 
        data: {
            id: user.id,
            email: user.email,
            name: user.name,
            roles: user.roles,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt
        } 
    });
});

// PUT /api/v1/users/profile - Обновление профиля
app.put('/api/v1/users/profile', authMiddleware, async (req, res) => {
    try {
        const validatedData = updateProfileSchema.parse(req.body);
        const user = users.get(req.userId);
        
        if (!user) {
            return res.status(404).json({ 
                success: false, 
                error: { 
                    code: 'USER_NOT_FOUND', 
                    message: 'Пользователь не найден' 
                } 
            });
        }
        
        // Проверка уникальности email при изменении
        if (validatedData.email && validatedData.email !== user.email) {
            const existingUser = Array.from(users.values()).find(u => 
                u.email.toLowerCase() === validatedData.email.toLowerCase() && u.id !== user.id
            );
            
            if (existingUser) {
                return res.status(400).json({ 
                    success: false, 
                    error: { 
                        code: 'EMAIL_EXISTS', 
                        message: 'Email уже используется другим пользователем' 
                    } 
                });
            }
        }
        
        if (validatedData.name) user.name = validatedData.name;
        if (validatedData.email) user.email = validatedData.email;
        user.updatedAt = new Date().toISOString();
        
        logger.info({ requestId: req.id, userId: user.id }, 'Profile updated');
        
        res.json({ 
            success: true, 
            data: {
                id: user.id,
                email: user.email,
                name: user.name,
                roles: user.roles,
                updatedAt: user.updatedAt
            } 
        });
    } catch (error) {
        logger.error({ requestId: req.id, error: error.message }, 'Profile update error');
        
        if (error instanceof z.ZodError) {
            return res.status(400).json({ 
                success: false, 
                error: { 
                    code: 'VALIDATION_ERROR', 
                    message: error.errors[0].message 
                } 
            });
        }
        
        res.status(500).json({ 
            success: false, 
            error: { 
                code: 'INTERNAL_ERROR', 
                message: 'Внутренняя ошибка сервера' 
            } 
        });
    }
});

// GET /api/v1/users - Список пользователей (только для admin)
app.get('/api/v1/users', authMiddleware, (req, res) => {
    if (!req.userRoles.includes('admin')) {
        logger.warn({ 
            requestId: req.id, 
            userId: req.userId, 
            roles: req.userRoles 
        }, 'Access denied - insufficient permissions');
        
        return res.status(403).json({ 
            success: false, 
            error: { 
                code: 'FORBIDDEN', 
                message: 'Недостаточно прав для выполнения этой операции' 
            } 
        });
    }
    
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const search = (req.query.search || '').toLowerCase();
    
    let userList = Array.from(users.values());
    
    // Поиск по email или имени
    if (search) {
        userList = userList.filter(u => 
            u.email.toLowerCase().includes(search) || 
            u.name.toLowerCase().includes(search)
        );
    }
    
    // Сортировка по дате создания (новые первые)
    userList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
    const total = userList.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedUsers = userList.slice(startIndex, endIndex);
    
    logger.info({ 
        requestId: req.id, 
        userId: req.userId, 
        total, 
        page, 
        limit 
    }, 'Users list retrieved');
    
    res.json({ 
        success: true, 
        data: {
            users: paginatedUsers.map(u => ({
                id: u.id,
                email: u.email,
                name: u.name,
                roles: u.roles,
                createdAt: u.createdAt
            })),
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
                hasNext: endIndex < total,
                hasPrev: page > 1
            }
        } 
    });
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        success: true,
        data: {
            service: 'Users Service',
            status: 'healthy',
            timestamp: new Date().toISOString(),
            usersCount: users.size
        }
    });
});

// 404 handler
app.use((req, res) => {
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
app.listen(PORT, async () => {
    await createAdminUser();
    logger.info({ 
        port: PORT, 
        environment: process.env.NODE_ENV || 'development' 
    }, 'Users service started');
});

module.exports = app;