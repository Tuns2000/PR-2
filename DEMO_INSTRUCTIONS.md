

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
$email="test_$(Get-Random)@test.com"; $body=@{email=$email;password="password123";name="Test User"}|ConvertTo-Json; $reg=Invoke-RestMethod "http://localhost:8000/api/v1/users/register" -Method POST -ContentType "application/json" -Body $body; Write-Host "✓ User registered: $($reg.data.id)" -ForegroundColor Green
```

### 3. Вход и получение токена
```powershell
$loginBody=@{email=$email;password="password123"}|ConvertTo-Json; $login=Invoke-RestMethod "http://localhost:8000/api/v1/users/login" -Method POST -ContentType "application/json" -Body $loginBody; $token=$login.data.token; Write-Host "✓ Login successful, token length: $($token.Length)" -ForegroundColor Green
```
### Просмотр Профиля 
```powershell
$headers=@{"Authorization"="Bearer $token"}; $profile=Invoke-RestMethod "http://localhost:8000/api/v1/users/profile" -Headers $headers; Write-Host "✓ Profile retrieved: $($profile.data.name), roles: $($profile.data.roles)" -ForegroundColor Green
```
### Изменение профиля
```powershell
$updateBody=@{name="Updated User"}|ConvertTo-Json; $upd=Invoke-RestMethod "http://localhost:8000/api/v1/users/profile" -Method PUT -Headers $headers -ContentType "application/json" -Body $updateBody; Write-Host "✓ Profile updated: $($upd.data.name)" -ForegroundColor Green
```
### 4. Создание заказа
```powershell
$orderBody=@{items=@(@{product="Цемент М5000";quantity=50;price=350},@{product="Песок речной";quantity=100;price=80})}|ConvertTo-Json -Depth 3; $order=Invoke-RestMethod "http://localhost:8000/api/v1/orders" -Method POST -Headers $headers -ContentType "application/json" -Body $orderBody; $orderId=$order.data.id; Write-Host "✓ Order created: ID=$orderId, Total=$($order.data.totalAmount), Status=$($order.data.status)" -ForegroundColor Green
```

### 5. Демонстрация проверки прав 

```powershell
$email2="user2_$(Get-Random)@test.com"; $body2=@{email=$email2;password="pass456";name="User 2"}|ConvertTo-Json; $reg2=Invoke-RestMethod "http://localhost:8000/api/v1/users/register" -Method POST -ContentType "application/json" -Body $body2; $loginBody2=@{email=$email2;password="pass456"}|ConvertTo-Json; $login2=Invoke-RestMethod "http://localhost:8000/api/v1/users/login" -Method POST -ContentType "application/json" -Body $loginBody2; $token2=$login2.data.token; Write-Host "✓ Second user created and logged in" -ForegroundColor Green

# Второй пользователь создает свой заказ
$orderBody2=@{items=@(@{product="Щебень";quantity=20;price=450})}|ConvertTo-Json -Depth 3; $order2=Invoke-RestMethod "http://localhost:8000/api/v1/orders" -Method POST -Headers @{"Authorization"="Bearer $token2"} -ContentType "application/json" -Body $orderBody2; $order2Id=$order2.data.id; Write-Host "✓ Second user created order: $order2Id" -ForegroundColor Green

# Первый пользователь пытается получить заказ второго
try { $forbidden=Invoke-RestMethod "http://localhost:8000/api/v1/orders/$order2Id" -Headers @{"Authorization"="Bearer $token"} -ErrorAction Stop; Write-Host "✗ FAIL: First user accessed second user's order!" -ForegroundColor Red } catch { if ($_.Exception.Response.StatusCode.value__ -eq 403) { Write-Host "✓ PASS: Access to other user's order correctly denied (403)" -ForegroundColor Green } else { Write-Host "✗ Wrong error code: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Yellow } }
```


## Остановка проекта

```powershell
docker-compose down
```