# Система управления задачами - Микросервисная архитектура

## Описание проекта
Микросервисная система для управления пользователями и заказами в строительных проектах.

## Архитектура
```
┌─────────────────┐
│   API Gateway   │ :8000
│   (прокси, JWT) │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
┌───▼──────┐ ┌▼───────────┐
│ Users    │ │ Orders     │
│ Service  │ │ Service    │
│ :8000    │ │ :8000      │
└──────────┘ └────────────┘
```

## Технологический стек
- **Runtime**: Node.js 18
- **Framework**: Express.js
- **Auth**: JWT (jsonwebtoken)
- **Logging**: Pino
- **Validation**: Zod
- **Resilience**: Opossum (Circuit Breaker)
- **Containerization**: Docker, Docker Compose

## Быстрый старт

### Требования
- Docker Desktop (с WSL 2 для Windows)
- Node.js 18+ (для локальной разработки)
- curl или Postman для тестирования

### Запуск проекта

**1. Клонирование и переход в директорию:**
```bash
cd micro-task-template
```

**2. Запуск в режиме разработки:**
```bash
docker-compose --env-file .env.development up --build
```

**3. Запуск в фоновом режиме:**
```bash
docker-compose --env-file .env.development up -d --build
```

**4. Остановка:**
```bash
docker-compose down
```

**5. Просмотр логов:**
```bash
docker-compose logs -f
docker-compose logs -f api_gateway
docker-compose logs -f service_users
```

## Проверка работоспособности

### Health Check
```bash
curl http://localhost:8000/health
```

Ожидаемый ответ:
```json
{
  "success": true,
  "data": {
    "status": "healthy",
    "timestamp": "2025-10-26T13:44:06.015Z"
  }
}
```

### Status Check
```bash
curl http://localhost:8000/status
```

## API Endpoints

### Публичные (без авторизации)

**Регистрация пользователя:**
```bash
curl -X POST http://localhost:8000/api/v1/users/register \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"test@example.com\",\"password\":\"password123\",\"name\":\"Test User\"}"
```

**Вход:**
```bash
curl -X POST http://localhost:8000/api/v1/users/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"test@example.com\",\"password\":\"password123\"}"
```

Сохраните полученный `token` для дальнейших запросов.

### Защищенные (требуют JWT токен)

**Получение профиля:**
```bash
curl http://localhost:8000/api/v1/users/profile \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

**Обновление профиля:**
```bash
curl -X PUT http://localhost:8000/api/v1/users/profile \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"Updated Name\"}"
```

**Создание заказа:**
```bash
curl -X POST http://localhost:8000/api/v1/orders \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d "{\"items\":[{\"product\":\"Цемент М500\",\"quantity\":50,\"price\":350},{\"product\":\"Песок речной\",\"quantity\":100,\"price\":80}]}"
```

**Список заказов:**
```bash
curl "http://localhost:8000/api/v1/orders?page=1&limit=10&sortBy=createdAt&sortOrder=desc" \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

**Получение заказа по ID:**
```bash
curl http://localhost:8000/api/v1/orders/ORDER_ID \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

**Обновление статуса заказа:**
```bash
curl -X PATCH http://localhost:8000/api/v1/orders/ORDER_ID/status \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json" \
  -d "{\"status\":\"in_progress\"}"
```

**Отмена заказа:**
```bash
curl -X DELETE http://localhost:8000/api/v1/orders/ORDER_ID \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

## Тестирование

### Postman
1. Импортируйте коллекцию: `docs/postman_collection.json`
2. Установите переменную `baseUrl`: `http://localhost:8000/api/v1`
3. Запустите тесты: Collection Runner → Run

### Автоматические тесты
Коллекция Postman содержит автоматические проверки:
- Статус коды
- Структура ответов
- Валидация данных
- Сохранение токенов

## Окружения

### Development
```bash
docker-compose --env-file .env.development up --build
```
- Порт: 8000
- Логи: debug
- JWT время жизни: 24h

### Test
```bash
docker-compose --env-file .env.test up --build
```
- Порт: 8000
- Логи: info
- JWT время жизни: 1h

### Production
```bash
docker-compose --env-file .env.production up -d --build
```
- Порт: 8000
- Логи: warn
- JWT время жизни: 8h
- **Важно:** Измените `JWT_SECRET` в `.env.production`!

## Переменные окружения

Создайте файл `.env` на основе `.env.example`:

```env
NODE_ENV=development
GATEWAY_PORT=8000
LOG_LEVEL=info
JWT_SECRET=your-super-secret-key-min-32-chars
JWT_EXPIRES_IN=24h
CORS_ORIGIN=*
```

## Документация API

Полная спецификация OpenAPI 3.0: `docs/openapi.yaml`

Можно просмотреть в:
- [Swagger Editor](https://editor.swagger.io/)
- [Swagger UI](https://swagger.io/tools/swagger-ui/)

## Структура проекта

```
micro-task-template/
├── api_gateway/          # API Gateway
│   ├── Dockerfile
│   ├── index.js
│   └── package.json
├── service_users/        # Сервис пользователей
│   ├── Dockerfile
│   ├── index.js
│   └── package.json
├── service_orders/       # Сервис заказов
│   ├── Dockerfile
│   ├── index.js
│   └── package.json
├── docs/                 # Документация
│   ├── openapi.yaml      # OpenAPI спецификация
│   ├── postman_collection.json
│   └── CHECKLIST.md      # Чек-лист проверки
├── docker-compose.yml    # Оркестрация
├── .env.development      # Dev окружение
├── .env.test             # Test окружение
├── .env.production       # Prod окружение
├── .env.example          # Пример конфигурации
└── README.md             # Документация
```

## Troubleshooting



````bash
// filepath: c:\Users\arsen\Desktop\Tecno\PR-2\micro-task-template\test_api.ps1
# PowerShell скрипт для тестирования API

$baseUrl = "http://localhost:8000/api/v1"

Write-Host "`n=== 1. Health Check ===" -ForegroundColor Green
curl.exe http://localhost:8000/health

Write-Host "`n`n=== 2. Регистрация пользователя ===" -ForegroundColor Green
$registerResponse = curl.exe -X POST "$baseUrl/users/register" `
  -H "Content-Type: application/json" `
  -d '{"email":"test@example.com","password":"password123","name":"Test User"}' `
  --silent
Write-Host $registerResponse

Write-Host "`n`n=== 3. Вход (получение токена) ===" -ForegroundColor Green
$loginResponse = curl.exe -X POST "$baseUrl/users/login" `
  -H "Content-Type: application/json" `
  -d '{"email":"test@example.com","password":"password123"}' `
  --silent
$loginData = $loginResponse | ConvertFrom-Json
$token = $loginData.data.token
Write-Host $loginResponse
Write-Host "`nToken: $token" -ForegroundColor Yellow

Write-Host "`n`n=== 4. Получение профиля ===" -ForegroundColor Green
curl.exe "$baseUrl/users/profile" `
  -H "Authorization: Bearer $token" `
  --silent

Write-Host "`n`n=== 5. Создание заказа ===" -ForegroundColor Green
$orderResponse = curl.exe -X POST "$baseUrl/orders" `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" `
  -d '{"items":[{"product":"Цемент М500","quantity":50,"price":350},{"product":"Песок","quantity":100,"price":80}]}' `
  --silent
$orderData = $orderResponse | ConvertFrom-Json
$orderId = $orderData.data.id
Write-Host $orderResponse

Write-Host "`n`n=== 6. Список заказов ===" -ForegroundColor Green
curl.exe "$baseUrl/orders?page=1&limit=10" `
  -H "Authorization: Bearer $token" `
  --silent

Write-Host "`n`n=== 7. Обновление статуса ===" -ForegroundColor Green
curl.exe -X PATCH "$baseUrl/orders/$orderId/status" `
  -H "Authorization: Bearer $token" `
  -H "Content-Type: application/json" `
  -d '{"status":"in_progress"}' `
  --silent

Write-Host "`n`n=== ТЕСТЫ ЗАВЕРШЕНЫ ===" -ForegroundColor Green