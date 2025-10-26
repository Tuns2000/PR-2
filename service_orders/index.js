const express = require('express');
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

app.use(express.json());

// In-memory database (в продакшене использовать PostgreSQL/MongoDB)
const orders = new Map();

// Validation schemas
const createOrderSchema = z.object({
    items: z.array(z.object({
        product: z.string().min(1, 'Название товара обязательно').max(200),
        quantity: z.number().int().positive('Количество должно быть положительным числом'),
        price: z.number().positive('Цена должна быть положительным числом')
    })).min(1, 'Заказ должен содержать хотя бы один товар').max(100, 'Слишком много товаров в заказе')
});

const updateStatusSchema = z.object({
    status: z.enum(['created', 'in_progress', 'completed', 'cancelled'], {
        errorMap: () => ({ message: 'Недопустимый статус. Допустимые значения: created, in_progress, completed, cancelled' })
    })
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

// Event publisher (заглушка для будущего брокера сообщений RabbitMQ/Kafka)
const publishEvent = (eventType, data) => {
    logger.info({ 
        eventType, 
        data,
        timestamp: new Date().toISOString() 
    }, 'Domain event published');
    // TODO: Интеграция с RabbitMQ/Kafka для event-driven архитектуры
};

// POST /api/v1/orders - Создание заказа
app.post('/api/v1/orders', authMiddleware, (req, res) => {
    try {
        const validatedData = createOrderSchema.parse(req.body);
        
        // Расчет итоговой суммы
        const totalAmount = validatedData.items.reduce((sum, item) => 
            sum + (item.price * item.quantity), 0
        );
        
        const order = {
            id: uuidv4(),
            userId: req.userId,
            items: validatedData.items,
            status: 'created',
            totalAmount: parseFloat(totalAmount.toFixed(2)),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        orders.set(order.id, order);
        
        // Публикация доменного события
        publishEvent('ORDER_CREATED', { 
            orderId: order.id, 
            userId: order.userId,
            totalAmount: order.totalAmount,
            itemsCount: order.items.length
        });
        
        logger.info({ 
            requestId: req.id, 
            orderId: order.id, 
            userId: req.userId,
            totalAmount: order.totalAmount
        }, 'Order created successfully');
        
        res.status(201).json({ success: true, data: order });
    } catch (error) {
        logger.error({ 
            requestId: req.id, 
            error: error.message 
        }, 'Order creation error');
        
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

// GET /api/v1/orders/:id - Получение заказа по ID
app.get('/api/v1/orders/:id', authMiddleware, (req, res) => {
    const order = orders.get(req.params.id);
    
    if (!order) {
        logger.warn({ requestId: req.id, orderId: req.params.id }, 'Order not found');
        return res.status(404).json({ 
            success: false, 
            error: { 
                code: 'ORDER_NOT_FOUND', 
                message: 'Заказ не найден' 
            } 
        });
    }
    
    // Проверка прав доступа: только владелец заказа или admin
    if (order.userId !== req.userId && !req.userRoles.includes('admin')) {
        logger.warn({ 
            requestId: req.id, 
            orderId: order.id, 
            userId: req.userId, 
            orderUserId: order.userId 
        }, 'Access denied - not order owner');
        
        return res.status(403).json({ 
            success: false, 
            error: { 
                code: 'FORBIDDEN', 
                message: 'Недостаточно прав для доступа к этому заказу' 
            } 
        });
    }
    
    logger.info({ requestId: req.id, orderId: order.id }, 'Order retrieved');
    res.json({ success: true, data: order });
});

// GET /api/v1/orders - Список заказов
app.get('/api/v1/orders', authMiddleware, (req, res) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
    const sortBy = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const status = req.query.status;
    
    // Фильтрация: admin видит все заказы, обычный пользователь - только свои
    let userOrders = Array.from(orders.values()).filter(o => 
        o.userId === req.userId || req.userRoles.includes('admin')
    );
    
    // Фильтрация по статусу
    if (status && ['created', 'in_progress', 'completed', 'cancelled'].includes(status)) {
        userOrders = userOrders.filter(o => o.status === status);
    }
    
    // Сортировка
    userOrders.sort((a, b) => {
        let aVal = a[sortBy];
        let bVal = b[sortBy];
        
        // Для дат конвертируем в timestamp
        if (sortBy === 'createdAt' || sortBy === 'updatedAt') {
            aVal = new Date(aVal).getTime();
            bVal = new Date(bVal).getTime();
        }
        
        if (aVal < bVal) return -1 * sortOrder;
        if (aVal > bVal) return 1 * sortOrder;
        return 0;
    });
    
    const total = userOrders.length;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedOrders = userOrders.slice(startIndex, endIndex);
    
    logger.info({ 
        requestId: req.id, 
        userId: req.userId, 
        total, 
        page, 
        limit,
        isAdmin: req.userRoles.includes('admin')
    }, 'Orders list retrieved');
    
    res.json({ 
        success: true, 
        data: {
            orders: paginatedOrders,
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

// PATCH /api/v1/orders/:id/status - Обновление статуса заказа
app.patch('/api/v1/orders/:id/status', authMiddleware, (req, res) => {
    try {
        const validatedData = updateStatusSchema.parse(req.body);
        const order = orders.get(req.params.id);
        
        if (!order) {
            return res.status(404).json({ 
                success: false, 
                error: { 
                    code: 'ORDER_NOT_FOUND', 
                    message: 'Заказ не найден' 
                } 
            });
        }
        
        // Проверка прав: только владелец заказа или admin
        if (order.userId !== req.userId && !req.userRoles.includes('admin')) {
            logger.warn({ 
                requestId: req.id, 
                orderId: order.id, 
                userId: req.userId 
            }, 'Access denied - cannot update order status');
            
            return res.status(403).json({ 
                success: false, 
                error: { 
                    code: 'FORBIDDEN', 
                    message: 'Недостаточно прав для изменения статуса этого заказа' 
                } 
            });
        }
        
        // Проверка валидности перехода статуса
        if (order.status === 'completed' && validatedData.status !== 'completed') {
            return res.status(400).json({ 
                success: false, 
                error: { 
                    code: 'INVALID_STATUS_TRANSITION', 
                    message: 'Невозможно изменить статус завершенного заказа' 
                } 
            });
        }
        
        if (order.status === 'cancelled' && validatedData.status !== 'cancelled') {
            return res.status(400).json({ 
                success: false, 
                error: { 
                    code: 'INVALID_STATUS_TRANSITION', 
                    message: 'Невозможно изменить статус отмененного заказа' 
                } 
            });
        }
        
        const oldStatus = order.status;
        order.status = validatedData.status;
        order.updatedAt = new Date().toISOString();
        
        // Публикация доменного события
        publishEvent('ORDER_STATUS_UPDATED', { 
            orderId: order.id, 
            userId: order.userId,
            oldStatus, 
            newStatus: order.status,
            updatedBy: req.userId
        });
        
        logger.info({ 
            requestId: req.id, 
            orderId: order.id, 
            oldStatus, 
            newStatus: order.status 
        }, 'Order status updated');
        
        res.json({ success: true, data: order });
    } catch (error) {
        logger.error({ requestId: req.id, error: error.message }, 'Status update error');
        
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

// DELETE /api/v1/orders/:id - Отмена заказа
app.delete('/api/v1/orders/:id', authMiddleware, (req, res) => {
    const order = orders.get(req.params.id);
    
    if (!order) {
        return res.status(404).json({ 
            success: false, 
            error: { 
                code: 'ORDER_NOT_FOUND', 
                message: 'Заказ не найден' 
            } 
        });
    }
    
    // Проверка прав: только владелец заказа или admin
    if (order.userId !== req.userId && !req.userRoles.includes('admin')) {
        logger.warn({ 
            requestId: req.id, 
            orderId: order.id, 
            userId: req.userId 
        }, 'Access denied - cannot cancel order');
        
        return res.status(403).json({ 
            success: false, 
            error: { 
                code: 'FORBIDDEN', 
                message: 'Недостаточно прав для отмены этого заказа' 
            } 
        });
    }
    
    // Проверка возможности отмены
    if (order.status === 'completed') {
        return res.status(400).json({ 
            success: false, 
            error: { 
                code: 'CANNOT_CANCEL_COMPLETED', 
                message: 'Невозможно отменить завершенный заказ' 
            } 
        });
    }
    
    if (order.status === 'cancelled') {
        return res.status(400).json({ 
            success: false, 
            error: { 
                code: 'ALREADY_CANCELLED', 
                message: 'Заказ уже отменен' 
            } 
        });
    }
    
    const oldStatus = order.status;
    order.status = 'cancelled';
    order.updatedAt = new Date().toISOString();
    
    // Публикация доменного события
    publishEvent('ORDER_CANCELLED', { 
        orderId: order.id, 
        userId: order.userId,
        oldStatus,
        cancelledBy: req.userId
    });
    
    logger.info({ 
        requestId: req.id, 
        orderId: order.id,
        oldStatus
    }, 'Order cancelled');
    
    res.json({ success: true, data: order });
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        success: true,
        data: {
            service: 'Orders Service',
            status: 'healthy',
            timestamp: new Date().toISOString(),
            ordersCount: orders.size
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
app.listen(PORT, () => {
    logger.info({ 
        port: PORT, 
        environment: process.env.NODE_ENV || 'development' 
    }, 'Orders service started');
});

module.exports = app;