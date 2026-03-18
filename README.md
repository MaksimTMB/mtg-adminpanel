# MTG AdminPanel v2.1.0

Веб-панель управления MTG прокси серверами (Telegram MTPROTO proxy). Позволяет управлять несколькими нодами и клиентами через единый интерфейс с мониторингом в реальном времени.

![Version](https://img.shields.io/badge/version-2.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![Docker](https://img.shields.io/badge/docker-required-blue)

---

## Содержание

- [Возможности](#возможности)
- [Архитектура](#архитектура)
- [Требования](#требования)
- [Быстрый старт](#быстрый-старт)
- [Установка панели](#установка-панели)
- [Установка MTG Agent на ноды](#установка-mtg-agent-на-ноды)
- [Настройка нод в панели](#настройка-нод-в-панели)
- [Двухфакторная аутентификация (TOTP)](#двухфакторная-аутентификация-totp)
- [Структура проекта](#структура-проекта)
- [API Reference](#api-reference)
- [Переменные окружения](#переменные-окружения)
- [Обновление](#обновление)
- [Разработка](#разработка)
- [Changelog](#changelog)

---

## Возможности

### Управление нодами
- Добавление, редактирование и удаление нод
- Поддержка SSH авторизации: пароль и SSH ключ
- Отображение онлайн/офлайн статуса в реальном времени (кэш < 5 мс)
- Флаги стран для каждой ноды (ISO 3166-1 alpha-2)
- Страница каждой ноды с детальной статистикой

### Управление клиентами
- Создание и удаление MTG прокси контейнеров через SSH
- Синхронизация клиентов с нодами (импорт существующих)
- Просмотр трафика (rx/tx) в реальном времени
- QR-коды и ссылки для подключения
- Ручной сброс трафика
- Страница всех клиентов всех нод

### Лимиты и автоматизация
- **Лимит устройств** — максимальное количество одновременных IP-подключений. При превышении прокси автоматически останавливается
- **Автосброс трафика** — сброс счётчиков трафика: ежедневно / ежемесячно / ежегодно
- **Накопленный трафик** — суммарный трафик за всё время хранится в базе данных
- **Автостоп по истечению** — клиенты с истёкшим сроком останавливаются автоматически
- **История подключений** — записывается каждые 5 минут, хранится 48 записей (~4 часа)

### MTG Agent (рекомендуется)
- Лёгкий HTTP агент на каждой ноде (Python FastAPI)
- Подсчёт уникальных IP-адресов (≈ устройств) через `/proc/{pid}/net/tcp6`
- Трафик через Docker Stats API (rx/tx байт)
- Работает в Docker с `pid: host` и `network_mode: host`
- Установка и обновление через панель одной кнопкой

### Безопасность
- Токен-авторизация для всех API запросов
- TOTP 2FA — опциональная двухфакторная аутентификация
- Сессионное хранение TOTP-кода (sessionStorage)

### Дашборд
- Сводная статистика: ноды (онлайн/офлайн), клиенты (активных / остановлен / онлайн)
- Карточки нод с пиллами: всего / активных / онлайн / остановлен
- Быстрый переход к клиентам и странице ноды

---

## Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│              Reverse Proxy (Nginx / Caddy) — SSL            │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│   MTG AdminPanel (Docker Container)                         │
│                                                             │
│   ┌─────────────────────────┐   ┌───────────────────────┐  │
│   │   React 18 + Vite SPA   │   │   Node.js Express API │  │
│   │   (статика из /public)  │◄──│   Порт: 3000          │  │
│   └─────────────────────────┘   │   SQLite /data/*.db   │  │
│                                  │   nodeCache (10 сек)  │  │
│                                  └───────────┬───────────┘  │
└──────────────────────────────────────────────┼──────────────┘
                                               │
                              ┌────────────────┴────────────────┐
                              │   SSH + HTTP к агентам           │
                              └────────────────┬────────────────┘
                                               │
                  ┌────────────────────────────┼────────────────────────────┐
                  │                            │                            │
                  ▼                            ▼                            ▼
         ┌──────────────┐            ┌──────────────┐            ┌──────────────┐
         │    Нода A    │            │    Нода B    │            │    Нода C    │
         │              │            │              │            │              │
         │ MTG Agent    │            │ MTG Agent    │            │ (SSH only)   │
         │ :8081        │            │ :8081        │            │              │
         │              │            │              │            │              │
         │ mtg-user1    │            │ mtg-user3    │            │ mtg-user5    │
         │ mtg-user2    │            │ mtg-user4    │            │ mtg-user6    │
         └──────────────┘            └──────────────┘            └──────────────┘
```

### Логика получения метрик

| Режим | Скорость | Точность | Требования |
|-------|----------|----------|------------|
| **MTG Agent** (рекомендуется) | < 10 мс | Высокая (уникальные IP) | Агент установлен |
| **SSH fallback** | 2–5 сек | Средняя (кол-во соединений) | SSH доступ |

### Кэш нод

`nodeCache.js` каждые **10 секунд** опрашивает все ноды в параллельных потоках и хранит данные в памяти. Все API запросы отвечают мгновенно (< 5 мс) из кэша.

---

## Требования

### Панель
- Docker и Docker Compose v2+
- Открытый порт (по умолчанию 3000) или reverse proxy

### Ноды
- Docker и Docker Compose
- SSH доступ с сервера панели (пароль или ключ)
- MTG контейнеры в формате `/opt/mtg/users/{name}/`
- Порт 8081 открыт (если используется MTG Agent)

---

## Быстрый старт

```bash
git clone https://github.com/MaksimTMB/mtg-adminpanel.git /opt/mtg-adminpanel
cd /opt/mtg-adminpanel
cp .env.example .env
# Отредактируй .env: установи AUTH_TOKEN (пароль для входа)
docker compose up -d
```

Панель доступна на `http://your-server:3000`

---

## Установка панели

### 1. Клонировать репозиторий

```bash
git clone https://github.com/MaksimTMB/mtg-adminpanel.git /opt/mtg-adminpanel
cd /opt/mtg-adminpanel
```

### 2. Настроить переменные окружения

```bash
cp .env.example .env
nano .env
```

Минимальная конфигурация:
```env
AUTH_TOKEN=your-strong-password-here  # Обязательно: пароль для входа в панель
AGENT_TOKEN=mtg-agent-secret          # Токен агента (должен совпадать на нодах)
AGENT_PORT=8081                       # Порт агента на нодах
PORT=3000                             # Порт веб-интерфейса
```

### 3. Запустить

```bash
docker compose up -d
```

Панель доступна на `http://your-server:3000`

### 4. Настроить обратный прокси (рекомендуется)

**Nginx:**
```nginx
server {
    listen 443 ssl;
    server_name panel.example.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

**Caddy:**
```caddyfile
panel.example.com {
    reverse_proxy localhost:3000
}
```

---

## Установка MTG Agent на ноды

MTG Agent — лёгкий Python FastAPI сервис, устанавливаемый на каждую ноду. Обеспечивает точный подсчёт устройств и трафика в реальном времени.

### Способ 1: Через панель (рекомендуется)

1. Открой панель → **Ноды** → ✏️ нужной ноды
2. В секции **MTG Agent** нажми **Установить** — скопируй команду
3. Выполни команду на ноде:
   ```bash
   ssh root@your-node.com
   # вставь скопированную команду
   ```
4. В поле **Порт агента** введи `8081`
5. Нажми **Проверить** — должно появиться зелёное "Онлайн"
6. Нажми **Сохранить**

### Способ 2: Вручную через SSH

```bash
ssh root@your-node.com

mkdir -p /opt/mtg-agent && cd /opt/mtg-agent
wget -q https://raw.githubusercontent.com/MaksimTMB/mtg-adminpanel/main/mtg-agent/install-agent.sh -O install.sh
bash install.sh YOUR_AGENT_TOKEN
```

Замени `YOUR_AGENT_TOKEN` на значение `AGENT_TOKEN` из файла `.env` панели.

### Обновление агента

**Через панель:** ✏️ ноды → кнопка **Обновить** в секции MTG Agent.

**Вручную на ноде:**
```bash
cd /opt/mtg-agent
wget -q https://raw.githubusercontent.com/MaksimTMB/mtg-adminpanel/main/mtg-agent/main.py -O main.py
docker compose down && docker compose up -d
```

### Проверка работы агента

```bash
# Здоровье
curl http://localhost:8081/health

# Метрики (с токеном)
curl http://localhost:8081/metrics -H "x-agent-token: YOUR_AGENT_TOKEN"
```

---

## Настройка нод в панели

### Структура MTG на ноде

Панель ожидает следующую структуру на каждой ноде:

```
/opt/mtg/users/
├── alice/
│   ├── config.toml          # secret, bind-to
│   └── docker-compose.yml   # образ mtg:2, проброс порта
├── bob/
│   ├── config.toml
│   └── docker-compose.yml
└── ...
```

Панель создаёт эти файлы автоматически при добавлении нового клиента.

### Параметры ноды

| Параметр | Описание | Пример |
|----------|----------|--------|
| Название | Отображаемое имя | `Helsinki` |
| Host / IP | Адрес сервера или домен | `hel.example.com` |
| SSH User | Пользователь SSH | `root` |
| SSH Port | Порт SSH | `22` |
| SSH ключ | Приватный ключ (если без пароля) | `/ssh_keys/id_rsa` |
| Base Dir | Директория с клиентами | `/opt/mtg/users` |
| Start Port | Начальный порт для новых клиентов | `4433` |
| Флаг | Код страны (ISO 3166-1 alpha-2) | `fi` |
| Порт агента | Порт MTG Agent (0 = без агента) | `8081` |

### Настройки клиента

| Параметр | Описание |
|----------|----------|
| Заметка | Произвольный текст (имя, контакт) |
| Истекает | Дата истечения — клиент останавливается автоматически |
| Лимит трафика (ГБ) | Только для отображения |
| Макс. устройств | Лимит уникальных IP. При превышении — автостоп |
| Автосброс трафика | Интервал: `daily` / `monthly` / `yearly` |

### Биллинг (опционально)

| Параметр | Описание |
|----------|----------|
| Цена | Стоимость подписки |
| Валюта | `RUB`, `USD`, `EUR` и др. |
| Период | Период оплаты (месяц, год) |
| Оплачено до | Дата следующей оплаты |
| Статус | `active` / `trial` / `expired` |

---

## Двухфакторная аутентификация (TOTP)

Панель поддерживает TOTP 2FA (Google Authenticator, Aegis, Authy и др.).

### Включить 2FA

1. Открой панель → **Настройки**
2. Нажми **Настроить 2FA**
3. Отсканируй QR-код в приложении аутентификатора
4. Введи 6-значный код из приложения
5. Нажми **Подтвердить**

### Вход с 2FA

После ввода токена авторизации панель запросит TOTP-код.
Код действует 30 секунд и хранится в `sessionStorage` браузера.

### Отключить 2FA

Настройки → **Отключить 2FA** → подтвердить текущим TOTP-кодом.

### Восстановление доступа (если потерян доступ к TOTP)

Если доступ к приложению аутентификатора утерян, отключи TOTP напрямую через базу данных:

```bash
docker exec -it mtg-panel sh
sqlite3 /data/mtg-panel.db "DELETE FROM settings WHERE key='totp_enabled';"
exit
```

---

## Структура проекта

```
mtg-adminpanel/
├── backend/                        # Node.js Express сервер
│   ├── src/
│   │   ├── app.js                  # API эндпоинты, фоновые задачи
│   │   ├── db.js                   # SQLite схема и миграции
│   │   ├── ssh.js                  # SSH + HTTP к агентам
│   │   ├── nodeCache.js            # Фоновый кэш (10 сек)
│   │   └── totp.js                 # TOTP 2FA
│   ├── public/                     # Собранный фронтенд (Vite output)
│   └── package.json
│
├── frontend/                       # React 18 + Vite фронтенд
│   ├── src/
│   │   ├── components/             # React компоненты
│   │   │   ├── Dashboard.jsx       # Дашборд
│   │   │   ├── NodesPage.jsx       # Список нод
│   │   │   ├── UsersPage.jsx       # Клиенты ноды
│   │   │   ├── AllUsersPage.jsx    # Все клиенты
│   │   │   ├── SettingsPage.jsx    # Настройки / 2FA
│   │   │   ├── NodeModal.jsx       # Добавление/редактирование ноды
│   │   │   ├── UserModal.jsx       # Добавление клиента
│   │   │   ├── EditUserModal.jsx   # Редактирование клиента
│   │   │   └── ...
│   │   ├── App.jsx                 # Маршрутизация приложения
│   │   ├── api.js                  # API клиент с auth/TOTP
│   │   ├── constants.js            # Константы
│   │   ├── icons.jsx               # SVG иконки
│   │   ├── utils.jsx               # Вспомогательные функции
│   │   ├── toast.jsx               # Уведомления
│   │   ├── main.jsx                # React entry point
│   │   └── index.css               # Стили
│   ├── vite.config.js
│   └── package.json
│
├── mtg-agent/                      # Python агент для нод
│   ├── main.py                     # FastAPI приложение
│   ├── docker-compose.yml          # Docker конфиг агента
│   ├── install-agent.sh            # Скрипт установки
│   └── Dockerfile
│
├── docker-compose.yml              # Docker конфиг панели
├── Dockerfile                      # Multi-stage build
├── .env.example                    # Шаблон переменных окружения
├── install.sh                      # Интерактивный установщик
├── update.sh                       # Скрипт обновления
└── uninstall.sh                    # Скрипт удаления
```

---

## API Reference

### Аутентификация

Все запросы (кроме `/api/version`) требуют заголовок:
```
x-auth-token: YOUR_AUTH_TOKEN
```

Если включена 2FA, также требуется:
```
x-totp-code: 123456
```

При отсутствии TOTP API возвращает:
```json
{ "error": "TOTP required", "totp": true }
```

---

### Общее

| Метод | URL | Описание |
|-------|-----|----------|
| GET | `/api/version` | Версия панели (без авторизации) |
| GET | `/api/status` | Статус всех нод из кэша (мгновенно) |

---

### Ноды

| Метод | URL | Описание |
|-------|-----|----------|
| GET | `/api/nodes` | Список всех нод |
| POST | `/api/nodes` | Создать ноду |
| PUT | `/api/nodes/:id` | Обновить настройки ноды |
| DELETE | `/api/nodes/:id` | Удалить ноду |
| GET | `/api/nodes/:id/check` | Проверить SSH и Agent доступность |
| GET | `/api/nodes/:id/check-agent` | Проверить MTG Agent |
| POST | `/api/nodes/:id/update-agent` | Установить/обновить агент через SSH |
| GET | `/api/nodes/:id/summary` | Сводка ноды (из кэша) |
| GET | `/api/nodes/:id/agent-version` | Версия установленного агента |
| GET | `/api/nodes/:id/mtg-version` | Версия образа MTG |
| POST | `/api/nodes/:id/mtg-update` | Обновить образ MTG на ноде |
| GET | `/api/nodes/:id/traffic` | Трафик всех клиентов ноды |
| GET | `/api/nodes/:id/debug` | Диагностическая информация |

---

### Клиенты

| Метод | URL | Описание |
|-------|-----|----------|
| GET | `/api/nodes/:id/users` | Список клиентов с метриками |
| POST | `/api/nodes/:id/users` | Создать клиента |
| PUT | `/api/nodes/:id/users/:name` | Обновить настройки клиента |
| DELETE | `/api/nodes/:id/users/:name` | Удалить клиента |
| POST | `/api/nodes/:id/users/:name/stop` | Остановить прокси |
| POST | `/api/nodes/:id/users/:name/start` | Запустить прокси |
| POST | `/api/nodes/:id/users/:name/reset-traffic` | Сбросить счётчик трафика |
| GET | `/api/nodes/:id/users/:name/history` | История подключений (48 записей) |
| POST | `/api/nodes/:id/sync` | Синхронизировать клиентов с нодой |

---

### TOTP / 2FA

| Метод | URL | Описание |
|-------|-----|----------|
| GET | `/api/totp/status` | Проверить включена ли 2FA |
| POST | `/api/totp/setup` | Инициализировать TOTP (возвращает secret + QR) |
| POST | `/api/totp/verify` | Подтвердить и включить TOTP |
| POST | `/api/totp/disable` | Отключить TOTP |

---

### MTG Agent API

Агент доступен на каждой ноде на порту 8081.

| Метод | URL | Заголовок | Описание |
|-------|-----|-----------|----------|
| GET | `/health` | — | Проверка доступности |
| GET | `/metrics` | `x-agent-token: TOKEN` | Метрики всех контейнеров |
| GET | `/users` | `x-agent-token: TOKEN` | Список клиентов с портами и секретами |

Пример ответа `/metrics`:
```json
{
  "containers": [
    {
      "name": "mtg-alice",
      "running": true,
      "status": "running",
      "connections": 3,
      "devices": 2,
      "is_online": true,
      "traffic": {
        "rx": "54.17MB",
        "tx": "56.24MB",
        "rx_bytes": 56797474,
        "tx_bytes": 58972294
      }
    }
  ],
  "total": 1
}
```

---

## Переменные окружения

### Панель (`.env`)

| Переменная | Описание | По умолчанию |
|-----------|----------|-------------|
| `AUTH_TOKEN` | **Пароль** для входа в панель (вводится на странице входа) | — (обязательно) |
| `PORT` | Порт веб-интерфейса | `3000` |
| `DATA_DIR` | Директория SQLite базы данных | `/data` |
| `AGENT_PORT` | Порт MTG Agent на нодах | `8081` |
| `AGENT_TOKEN` | Токен авторизации MTG Agent (должен совпадать на всех нодах) | `mtg-agent-secret` |

### Агент (`/opt/mtg-agent/.env`)

| Переменная | Описание | По умолчанию |
|-----------|----------|-------------|
| `AGENT_TOKEN` | Токен авторизации (должен совпадать с панелью) | `mtg-agent-secret` |
| `START_PORT` | Начальный порт при создании клиентов | `4433` |

---

## Обновление

### Панель

```bash
cd /opt/mtg-adminpanel
bash update.sh
```

Или вручную:
```bash
git pull origin main
docker compose up -d --build
```

> **Важно:** данные (`./data/`) и SSH ключи (`./ssh_keys/`) сохраняются в volumes — обновление не затрагивает базу данных.

### Агент на нодах

Через панель: **Ноды** → ✏️ → кнопка **Обновить** в секции MTG Agent.

Вручную на ноде:
```bash
cd /opt/mtg-agent
docker compose down
wget -q https://raw.githubusercontent.com/MaksimTMB/mtg-adminpanel/main/mtg-agent/main.py -O main.py
docker compose up -d
```

---

## Разработка

### Требования

- Node.js 20+
- Python 3.12+

### Запуск локально

**Бэкенд:**
```bash
cd backend
npm install
cp ../.env.example ../.env   # настрой AUTH_TOKEN
npm run dev                  # запускает nodemon на :3000
```

**Фронтенд (отдельный терминал):**
```bash
cd frontend
npm install
npm run dev                  # Vite dev server на :5173 с проксированием /api → :3000
```

**Сборка фронтенда:**
```bash
cd frontend
npm run build                # выход в backend/public/
```

### Docker сборка

```bash
docker compose up -d --build --no-cache
```

### Структура Dockerfile

```
Stage 1 (builder):
  - Node 20 Alpine
  - Установка зависимостей frontend
  - vite build → /app/public/

Stage 2 (production):
  - Node 20 Alpine
  - Установка production зависимостей backend
  - Копирование исходников + собранного фронтенда
  - EXPOSE 3000
  - CMD ["node", "src/app.js"]
```

---

## Changelog

### v2.1.0 (2026-03-18)

**Производительность:**
- Серверный кэш нод (`nodeCache.js`) — все API запросы отвечают < 5 мс
- Параллельный опрос всех нод каждые 10 секунд
- Устранены задержки 20–30 сек при загрузке страниц

**Фронтенд:**
- Полная миграция с Babel CDN на **Vite + React 18** (отдельный `frontend/` каталог)
- Страница всех клиентов всех нод (`AllUsersPage`)
- Улучшенный UI: онлайн-пиллы, флаги в заголовках, форматирование трафика

**Исправления:**
- Онлайн/офлайн статус клиентов — прямое сканирование Docker контейнеров вместо docker stats
- SSH fallback: подсчёт соединений через `/proc` хоста вместо `docker exec`
- Агент: чтение `/proc/{pid}/net/tcp` и `tcp6` для подсчёта уникальных IP
- Docker CLI fallback когда Docker SDK возвращает некорректные данные
- Исключение контейнера `mtg-panel` из списка MTG клиентов
- Исправлен URL скачивания агента
- Ужесточена защита от shell injection в SSH командах
- Исправлен TOTP middleware: правильная обработка exempt-эндпоинтов
- Исправлен краш при синхронизации с null-полями
- Исправлены конфликты портов при создании клиентов

**Backend:**
- `nodeCache.js` — отдельный модуль фонового кэша
- Эндпоинты `/api/nodes/:id/agent-version`, `/api/nodes/:id/mtg-version`, `/api/nodes/:id/mtg-update`
- Эндпоинт `/api/nodes/:id/debug` для диагностики

---

### v2.0.0 (2026-03-15)

**Новое:**
- MTG Agent — HTTP агент на каждой ноде для точных метрик
- Лимит устройств на клиента с автоматическим стопом при превышении
- Автосброс трафика (ежедневно / ежемесячно / ежегодно)
- Накопленный трафик за всё время в базе данных
- Страница каждой ноды с детальной статистикой
- Флаги стран высокого разрешения (flagcdn.com w80)
- Онлайн-пиллы на дашборде и карточках нод
- TOTP 2FA

**Исправлено:**
- Подсчёт подключений через `/proc/{pid}/net/tcp6` — точные данные для bridge network
- IPv4 форсирование для HTTP запросов к агенту
- Оператор `??` заменён на тернарный (совместимость)

**Breaking changes:**
- `agent_port` добавлен в таблицу `nodes` (миграция автоматическая)
- `max_devices`, `traffic_reset_interval`, `next_reset_at`, `total_traffic_*` добавлены в `users`

---

## Лицензия

MIT
