# БЫСТРЫЕ КОМАНДЫ ДЛЯ ПРОВЕРКИ

## Запуск проекта
```powershell
cd C:\Users\arsen\Desktop\Tecno\PR-2\micro-task-template
docker-compose up --build -d
```

## Проверка статуса
```powershell
docker-compose ps
```

## Быстрый тест API (копируй и вставляй в PowerShell)

```powershell
# 1. Health
Invoke-RestMethod http://localhost:8000/health | ConvertTo-Json

# 2. Регистрация
$email="test_$(Get-Random)@test.com"; $body=@{email=$email;password="pass123";name="User"}|ConvertTo-Json; $reg=Invoke-RestMethod http://localhost:8000/api/v1/users/register -Method POST -ContentType "application/json" -Body $body; Write-Host "Registered: $($reg.data.email)"

# 3. Вход
$loginBody=@{email=$email;password="pass123"}|ConvertTo-Json; $login=Invoke-RestMethod http://localhost:8000/api/v1/users/login -Method POST -ContentType "application/json" -Body $loginBody; $token=$login.data.token; Write-Host "Token length: $($token.Length)"

# 4. Профиль
$headers=@{"Authorization"="Bearer $token"}; $profile=Invoke-RestMethod http://localhost:8000/api/v1/users/profile -Headers $headers; Write-Host "Name: $($profile.data.name)"

# 5. Создать заказ
$orderBody=@{items=@(@{product="Цемент";quantity=50;price=350})}|ConvertTo-Json -Depth 3; $order=Invoke-RestMethod http://localhost:8000/api/v1/orders -Method POST -Headers $headers -ContentType "application/json" -Body $orderBody; $orderId=$order.data.id; Write-Host "Order ID: $orderId, Total: $($order.data.totalAmount)"

# 6. Список заказов
$list=Invoke-RestMethod "http://localhost:8000/api/v1/orders?page=1&limit=10" -Headers $headers; Write-Host "Orders: $($list.data.orders.Count)"

# 7. Обновить статус
$statusBody=@{status="in_progress"}|ConvertTo-Json; $upd=Invoke-RestMethod "http://localhost:8000/api/v1/orders/$orderId/status" -Method PATCH -Headers $headers -ContentType "application/json" -Body $statusBody; Write-Host "Status: $($upd.data.status)"

# 8. Отменить заказ
$cancelled=Invoke-RestMethod "http://localhost:8000/api/v1/orders/$orderId" -Method DELETE -Headers $headers; Write-Host "Cancelled: $($cancelled.data.status)"
```

## Тест на проверку прав

```powershell
# Создать второго пользователя
$email2="user2_$(Get-Random)@test.com"; $body2=@{email=$email2;password="pass";name="User2"}|ConvertTo-Json; Invoke-RestMethod http://localhost:8000/api/v1/users/register -Method POST -ContentType "application/json" -Body $body2 | Out-Null

# Войти как второй пользователь
$login2Body=@{email=$email2;password="pass"}|ConvertTo-Json; $login2=Invoke-RestMethod http://localhost:8000/api/v1/users/login -Method POST -ContentType "application/json" -Body $login2Body; $token2=$login2.data.token

# Создать заказ вторым пользователем
$order2Body=@{items=@(@{product="Щебень";quantity=10;price=400})}|ConvertTo-Json -Depth 3; $order2=Invoke-RestMethod http://localhost:8000/api/v1/orders -Method POST -Headers @{"Authorization"="Bearer $token2"} -ContentType "application/json" -Body $order2Body; $order2Id=$order2.data.id

# КРИТИЧНЫЙ ТЕСТ: Первый пользователь пытается получить заказ второго
try { Invoke-RestMethod "http://localhost:8000/api/v1/orders/$order2Id" -Headers @{"Authorization"="Bearer $token"} -ErrorAction Stop; Write-Host "FAIL: Access allowed!" -ForegroundColor Red } catch { if ($_.Exception.Response.StatusCode.value__ -eq 403) { Write-Host "PASS: Access denied (403)" -ForegroundColor Green } }
```

## Просмотр логов
```powershell
# Все логи
docker-compose logs -f

# Конкретный сервис
docker-compose logs -f api_gateway
docker-compose logs -f service_users
docker-compose logs -f service_orders
```

## Остановка
```powershell
docker-compose down
```