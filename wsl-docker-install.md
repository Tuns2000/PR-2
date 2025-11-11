## Шаг 1: Включение функции WSL в Windows
1. **Откройте PowerShell от имени администратора:**

- Нажмите Win + X и выберите "Windows PowerShell (администратор)".

- Или введите "PowerShell" в поиск Windows, нажмите правой кнопкой и выберите "Запуск от имени администратора".

2. **Введите команду для включения WSL:**

    `wsl --install`

    Эта команда автоматически установит WSL и скачает дистрибутив Ubuntu по умолчанию.

1. **Если команда выше не работает, выполните вручную:**

- `dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart`
- `dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart`

    Перезагрузите компьютер после выполнения команд.

## Шаг 2: Установка Docker Desktop
1. **Скачайте Docker Desktop для Windows:**

- Перейдите на официальный сайт: https://www.docker.com/products/docker-desktop/

- Нажмите "Download for Windows".

2. **Установите Docker Desktop:**

- Запустите скачанный установщик `Docker Desktop Installer.exe`.

- Следуйте инструкциям мастера установки (все параметры по умолчанию).

- **Обязательно поставьте галочку "Install required Windows components for WSL 2".**

- Перезагрузите компьютер, когда установка завершится.

##  Шаг 3: Перенос файлов проекта в WSL
Ваши файлы находятся в Windows, но Docker в WSL должен иметь к ним доступ. Есть два способа:

### Способ 1: Прямой доступ через файловую систему WSL (Проще)
- В WSL ваши диски Windows уже подключены.

- Перейдите в папку с вашим проектом. Например, если проект в `C:\Users\ВашеИмя\my_project`:

`cd /mnt/c/Users/ВашеИмя/my_project`

- C:\ становится /mnt/c/

- D:\ становится /mnt/d/ и т.д.

*Обратите внимание, буква диска пишется с **маленькой буквы**!!*

### Способ 2: Копирование файлов в домашнюю директорию WSL
1. **Перейдите в домашнюю директорию WSL:**

    `cd ~`

2. **Создайте папку для проекта:**

    ```
    mkdir my_project
    cd my_project
    ```

3. **Скопируйте файлы из Windows-директории (например, с рабочего стола):**

    `cp -r /mnt/c/Users/ВашеИмя/Desktop/my_project/* .`

    Замените путь на актуальный.

##  Шаг 5: Работа с Docker в WSL
1. **Откройте терминал WSL (Ubuntu):**

- Можно через Docker Desktop (вкладка WSL) или просто найдя "Ubuntu" в меню "Пуск".

2. **Перейдите в директорию вашего проекта** (используя один из способов выше).

3. **Убедитесь, что Docker работает:**
    ```
    docker --version
    # Должна отобразиться версия Docker
    docker ps
    # Должен показать пустой список контейнеров без ошибок

    # Проверяем версию Docker Compose Plugin
    docker compose version

    # Запускаем тестовый контейнер
    docker run hello-world
    ```
    Если команда hello-world выполнилась и вывела приветственное сообщение, установка прошла успешно.

##  Шаг 6: Сборка и запуск вашего FastAPI-приложения
1. **Соберите Docker-образ** (находясь в директории проекта):

    `docker compose up -d --build`

    Флаг --build принудительно пересобирает образ вашего приложения. 
    
    Флаг -d запускает контейнеры в фоновом режиме (daemon).
    
2. **Проверьте, что контейнер запустился:**

    `docker ps`
    
    В списке должны быть контейнеры (`service_users`, `service_orders` и `api_gateway`) со статусом "Up".

##  Шаг 7: Проверка работы API
1. **Проверьте логи контейнера** (убедитесь, что нет ошибок):

    docker compose logs api_gateway
    docker compose logs service_users
    docker compose logs service_orders

    *В логах должно быть сообщение, что Uvicorn запущен на 0.0.0.0:8000.*

2. Протестируйте эндпоинт `/status`:

    Из терминала WSL:

    `curl http://localhost:8000/status`

    Или из браузера на вашей Windows:
    - Откройте браузер и перейдите по адресу: http://localhost:8000/status

    Ожидаемый ответ: {"status":"API Gateway is running"}
