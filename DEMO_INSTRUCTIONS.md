# ИНСТРУКЦИЯ ДЛЯ ДЕМОНСТРАЦИИ ПРОЕКТА

## Перед демонстрацией

1. **Запустите Docker Desktop**
2. **Запустите проект:**
   ```powershell
   cd C:\Users\arsen\Desktop\Tecno\PR-2\micro-task-template
   docker-compose up --build -d
   ```

3. **Проверьте статус:**
   ```powershell
   docker-compose ps
   ```
   Все 3 сервиса должны быть `Up`

## Быстрая демонстрация (5 минут)

### 1. Health Check
```powershell
Invoke-RestMethod http://localhost:8000/health
```
**Ожидается:** `{"success":true,"data":{"status":"healthy",...}}`

### 2. Регистрация пользователя
```powershell
$email = "demo@test.com"
$body = @{
    email = $email
    password = "demo123"
    name = "Demo User"
} | ConvertTo-Json

Invoke-RestMethod http://localhost:8000/api/v1/users/register `
    -Method POST -ContentType "application/json" -Body $body
```

### 3. Вход и получение токена
```powershell
$loginBody = @{
    email = $email
    password = "demo123"
} | ConvertTo-Json

$login = Invoke-RestMethod http://localhost:8000/api/v1/users/login `
    -Method POST -ContentType "application/json" -Body $loginBody

$token = $login.data.token
Write-Host "Token получен: $($token.Substring(0,50))..."
```

### 4. Создание заказа
```powershell
$headers = @{ "Authorization" = "Bearer $token" }

$orderBody = @{
    items = @(
        @{ product = "Цемент М500"; quantity = 50; price = 350 },
        @{ product = "Песок речной"; quantity = 100; price = 80 }
    )
} | ConvertTo-Json -Depth 3

$order = Invoke-RestMethod http://localhost:8000/api/v1/orders `
    -Method POST -Headers $headers `
    -ContentType "application/json" -Body $orderBody

$orderId = $order.data.id
Write-Host "Заказ создан: $orderId"
Write-Host "Сумма: $($order.data.totalAmount) руб."
```

### 5. Демонстрация проверки прав (КРИТИЧНО ДЛЯ ОЦЕНКИ 5!)

```powershell
# Создаем второго пользователя
$email2 = "user2@test.com"
$body2 = @{
    email = $email2
    password = "pass456"
    name = "User 2"
} | ConvertTo-Json

Invoke-RestMethod http://localhost:8000/api/v1/users/register `
    -Method POST -ContentType "application/json" -Body $body2

# Входим как второй пользователь
$loginBody2 = @{
    email = $email2
    password = "pass456"
} | ConvertTo-Json

$login2 = Invoke-RestMethod http://localhost:8000/api/v1/users/login `
    -Method POST -ContentType "application/json" -Body $loginBody2

$token2 = $login2.data.token

# Второй пользователь создает свой заказ
$orderBody2 = @{
    items = @(@{ product = "Щебень"; quantity = 20; price = 450 })
} | ConvertTo-Json -Depth 3

$order2 = Invoke-RestMethod http://localhost:8000/api/v1/orders `
    -Method POST `
    -Headers @{ "Authorization" = "Bearer $token2" } `
    -ContentType "application/json" -Body $orderBody2

$order2Id = $order2.data.id

Write-Host "`n=== КРИТИЧНЫЙ ТЕСТ: Попытка доступа к чужому заказу ===" -ForegroundColor Yellow

# Первый пользователь пытается получить заказ второго
try {
    $forbidden = Invoke-RestMethod "http://localhost:8000/api/v1/orders/$order2Id" `
        -Headers @{ "Authorization" = "Bearer $token" } `
        -ErrorAction Stop
    
    Write-Host "❌ ПРОВАЛ: Доступ разрешен!" -ForegroundColor Red
} catch {
    if ($_.Exception.Response.StatusCode.value__ -eq 403) {
        Write-Host "✅ УСПЕХ: Доступ корректно заблокирован (403 Forbidden)" -ForegroundColor Green
        Write-Host "Проверка прав работает! Оценка 5 заслужена!" -ForegroundColor Green
    } else {
        Write-Host "⚠ Неожиданный код ошибки: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Yellow
    }
}
```

## Демонстрация в Postman (альтернатива)

1. Откройте Postman
2. Import → File → `docs/postman_collection.json`
3. Установите переменную `baseUrl` = `http://localhost:8000/api/v1`
4. Collection Runner → Run All Tests
5. Все тесты должны пройти ✅

## Демонстрация документации API

1. Откройте [Swagger Editor](https://editor.swagger.io/)
2. File → Import File → выберите `docs/openapi.yaml`
3. Покажите полную спецификацию API

## Просмотр логов с трассировкой

```powershell
# Логи API Gateway
docker-compose logs -f api_gateway

# Логи service_users
docker-compose logs -f service_users

# Логи service_orders
docker-compose logs -f service_orders
```

**Обратите внимание на:**
- `requestId` во всех логах
- Информацию о методе и URL
- Логирование аутентификации
- Логирование создания/обновления ресурсов

## Остановка проекта

```powershell
docker-compose down
```

## Ключевые моменты для защиты

### 1. Архитектура (покажите docker-compose.yml)
- API Gateway на порту 8000
- 2 микросервиса (users, orders)
- Взаимодействие через внутреннюю сеть Docker

### 2. Безопасность
- ✅ JWT аутентификация
- ✅ Хеширование паролей (bcrypt)
- ✅ Проверка прав доступа (403 на чужие ресурсы)
- ✅ Валидация данных (Zod)
- ✅ Rate Limiting

### 3. Надежность
- ✅ Circuit Breaker (Opossum)
- ✅ Health Check endpoints
- ✅ Структурированное логирование
- ✅ Request ID для трассировки

### 4. Документация
- ✅ OpenAPI 3.0 спецификация
- ✅ Postman коллекция с тестами
- ✅ README с инструкциями
- ✅ Чек-лист проверки

### 5. DevOps
- ✅ Docker контейнеризация
- ✅ Docker Compose оркестрация
- ✅ 3 окружения (dev/test/prod)
- ✅ .env файлы для конфигурации

## Вопросы, которые могут задать

**Q: Почему используется in-memory хранилище?**
A: Это упрощенная версия для демонстрации архитектуры. В продакшене использовалась бы PostgreSQL или MongoDB.

**Q: Как обеспечивается безопасность?**
A: JWT токены, хеширование паролей, проверка прав на уровне сервисов, валидация входных данных.

**Q: Как работает трассировка?**
A: X-Request-ID генерируется в API Gateway и прокидывается во все сервисы через заголовки.

**Q: Что такое Circuit Breaker?**
A: Паттерн для повышения устойчивости. Если сервис недоступен, Circuit Breaker "размыкается" и возвращает fallback ответ вместо бесконечных попыток подключения.

**Q: Как масштабировать систему?**
A: Docker Compose легко заменяется на Kubernetes. Каждый сервис можно масштабировать независимо.

---

**ГОТОВО К ЗАЩИТЕ НА ОЦЕНКУ 5! 🎓**
