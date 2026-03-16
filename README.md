# MTG AdminPanel v2.0.0

Веб-панель управления MTG прокси серверами (Telegram MTPROTO proxy). Позволяет управлять несколькими нодами и клиентами через единый интерфейс.

![Version](https://img.shields.io/badge/version-2.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

---

## Содержание

- [Возможности](#возможности)
- [Архитектура](#архитектура)
- [Требования](#требования)
- [Установка панели](#установка-панели)
- [Установка MTG Agent на ноды](#установка-mtg-agent-на-ноды)
- [Настройка нод в панели](#настройка-нод-в-панели)
- [Структура проекта](#структура-проекта)
- [API Reference](#api-reference)
- [Переменные окружения](#переменные-окружения)
- [Обновление](#обновление)

---

## Возможности

### Управление нодами
- Добавление, редактирование и удаление нод
- Поддержка SSH авторизации: пароль и SSH ключ
- Отображение онлайн/офлайн статуса в реальном времени
- Флаги стран для каждой ноды (высокое качество)
- Страница каждой ноды с детальной статистикой

### Управление клиентами
- Создание и удаление MTG прокси контейнеров через SSH
- Синхронизация клиентов с нодами
- Просмотр трафика (rx/tx) в реальном времени
- QR-коды и ссылки для подключения
- Ручной сброс трафика (перезапуск прокси)

### Лимиты и автоматизация
- **Лимит устройств** — максимальное количество одновременных подключений. При превышении прокси автоматически останавливается
- **Автосброс трафика** — сброс счётчиков трафика: ежедневно / ежемесячно / ежегодно
- **Накопленный трафик** — суммарный трафик за всё время хранится в базе данных
- **Автоудаление** — клиенты с истёкшим сроком удаляются автоматически
- **История подключений** — записывается каждые 5 минут, хранится 24 часа

### MTG Agent
- Лёгкий HTTP агент на каждой ноде (Python FastAPI)
- Читает метрики MTG контейнеров через Docker SDK
- Подсчёт уникальных IP-адресов (≈ устройств) через `/proc/{pid}/net/tcp6`
- Трафик через docker stats API
- Работает в Docker с `pid: host` и `network_mode: host`
- Установка и обновление через панель одной кнопкой

### Дашборд
- Сводная статистика: ноды (онлайн/офлайн), клиенты (активных/остановлен/онлайн)
- Карточки нод с пиллами: всего / активных / онлайн / остановлен
- Быстрый переход к клиентам и странице ноды

---

## Архитектура

```
┌─────────────────────────────┐
│   MTG AdminPanel (панель)   │
│   Node.js + Express + React  │
│   SQLite база данных         │
│   Порт: 3000                 │
└──────────┬──────────────────┘
           │
    ┌──────┴───────┐
    │  SSH / Agent  │
    └──────┬────────┘
           │
    ┌──────┴────────────────────────────────┐
    │              Ноды                      │
    │                                        │
    │  ┌─────────────┐  ┌─────────────────┐ │
    │  │  MTG Agent  │  │  MTG Containers │ │
    │  │  Port: 8081 │  │  mtg-admin      │ │
    │  │  FastAPI    │◄─│  mtg-liza       │ │
    │  │  pid: host  │  │  mtg-sam        │ │
    │  └─────────────┘  └─────────────────┘ │
    └───────────────────────────────────────┘
```

### Логика получения метрик

1. **С агентом** (рекомендуется): Панель делает HTTP запрос к агенту → агент читает `/proc/{pid}/net/tcp6` контейнера → возвращает уникальные IP к порту 3128
2. **Без агента** (SSH fallback): Панель подключается по SSH → выполняет команды в shell → медленнее, не показывает онлайн-устройства

---

## Требования

### Панель
- Docker и Docker Compose
- Доступ к нодам по SSH (пароль или ключ)
- Порт для панели (по умолчанию 3000)

### Ноды
- Docker и Docker Compose
- SSH доступ с панели
- MTG контейнеры запущены через Docker Compose в `/opt/mtg/users/{name}/`
- Открытый порт 8081 для MTG Agent (опционально)

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

```env
AUTH_TOKEN=your_secret_token_here
AGENT_TOKEN=mtg-agent-secret
AGENT_PORT=8081
```

### 3. Запустить через Docker Compose

```bash
docker compose up -d
```

Панель доступна на `http://your-server:3000`

### 4. Настроить обратный прокси (опционально)

Пример для Nginx Proxy Manager — добавь прокси хост:
- Domain: `panel.yourdomain.com`
- Forward: `http://localhost:3000`

---

## Установка MTG Agent на ноды

### Способ 1: Через панель (рекомендуется)

1. Открой панель → Ноды → ✏️ нужной ноды
2. В секции **MTG Agent** нажми **Установить** — скопируй команду
3. Выполни команду на ноде через SSH
4. В поле **Порт агента** введи `8081`
5. Нажми **Проверить** — убедись что агент доступен
6. Сохрани ноду

### Способ 2: Вручную через SSH

```bash
ssh root@your-node.com
mkdir -p /opt/mtg-agent && cd /opt/mtg-agent
wget -q https://raw.githubusercontent.com/MaksimTMB/mtg-adminpanel/main/mtg-agent/install-agent.sh -O install.sh
bash install.sh mtg-agent-secret
```

### Обновление агента

Через панель: ✏️ ноды → кнопка **Обновить** в секции MTG Agent.

Вручную:
```bash
cd /opt/mtg-agent
wget -q https://raw.githubusercontent.com/MaksimTMB/mtg-adminpanel/main/mtg-agent/main.py -O main.py
docker compose down && docker compose up -d
```

---

## Настройка нод в панели

### Структура MTG на ноде

Панель ожидает следующую структуру:

```
/opt/mtg/users/
├── admin/
│   ├── config.toml          # secret, bind-to
│   └── docker-compose.yml   # образ, порт
├── liza/
│   ├── config.toml
│   └── docker-compose.yml
└── ...
```

### Параметры ноды

| Параметр | Описание | Пример |
|----------|----------|--------|
| Название | Отображаемое имя | `Helsinki` |
| Host / IP | Адрес сервера | `hel.maks68.com` |
| SSH User | Пользователь SSH | `root` |
| SSH Port | Порт SSH | `22` |
| Base Dir | Директория с клиентами | `/opt/mtg/users` |
| Start Port | Начальный порт для новых клиентов | `4433` |
| Флаг | Код страны (ISO 3166-1 alpha-2) | `fi` |
| Порт агента | Порт MTG Agent | `8081` |

### Настройки клиента

| Параметр | Описание |
|----------|----------|
| Заметка | Произвольный текст (имя клиента, дата оплаты) |
| Истекает | Дата истечения — клиент удаляется автоматически |
| Лимит трафика (ГБ) | Максимальный трафик (не реализует автостоп, только отображение) |
| Макс. устройств | Лимит одновременных IP. При превышении — автостоп |
| Автосброс трафика | Интервал сброса: день / месяц / год |

---

## Структура проекта

```
mtg-adminpanel/
├── backend/
│   ├── src/
│   │   ├── app.js          # Express сервер, API эндпоинты, фоновые задачи
│   │   ├── db.js           # SQLite база данных, схема таблиц
│   │   └── ssh.js          # SSH подключения, логика агента
│   └── package.json
├── public/
│   └── index.html          # React SPA (Babel standalone)
├── mtg-agent/
│   ├── main.py             # FastAPI агент
│   ├── docker-compose.yml  # Docker конфиг агента
│   └── install-agent.sh    # Скрипт установки
├── docker-compose.yml      # Docker конфиг панели
├── Dockerfile
└── .env.example
```

---

## API Reference

### Аутентификация

Все запросы (кроме `/api/version`) требуют заголовок:
```
x-auth-token: YOUR_AUTH_TOKEN
```

### Ноды

| Метод | URL | Описание |
|-------|-----|----------|
| GET | `/api/nodes` | Список нод |
| POST | `/api/nodes` | Создать ноду |
| PUT | `/api/nodes/:id` | Обновить ноду |
| DELETE | `/api/nodes/:id` | Удалить ноду |
| GET | `/api/nodes/:id/check` | Проверить SSH/Agent доступность |
| GET | `/api/nodes/:id/check-agent` | Проверить MTG Agent |
| POST | `/api/nodes/:id/update-agent` | Установить/обновить агент через SSH |
| GET | `/api/status` | Статус всех нод (online_users, containers) |

### Клиенты

| Метод | URL | Описание |
|-------|-----|----------|
| GET | `/api/nodes/:id/users` | Список клиентов ноды с метриками |
| POST | `/api/nodes/:id/users` | Создать клиента |
| PUT | `/api/nodes/:id/users/:name` | Обновить настройки клиента |
| DELETE | `/api/nodes/:id/users/:name` | Удалить клиента |
| POST | `/api/nodes/:id/users/:name/stop` | Остановить прокси |
| POST | `/api/nodes/:id/users/:name/start` | Запустить прокси |
| POST | `/api/nodes/:id/users/:name/reset-traffic` | Сбросить трафик |
| GET | `/api/nodes/:id/users/:name/history` | История подключений |
| GET | `/api/nodes/:id/traffic` | Трафик всех клиентов ноды |
| POST | `/api/nodes/:id/sync` | Синхронизировать клиентов с нодой |

### MTG Agent API

| Метод | URL | Заголовок | Описание |
|-------|-----|-----------|----------|
| GET | `/health` | — | Проверка доступности |
| GET | `/metrics` | `x-agent-token: TOKEN` | Метрики контейнеров |

Пример ответа `/metrics`:
```json
{
  "containers": [
    {
      "name": "mtg-admin",
      "running": true,
      "status": "running",
      "connections": 2,
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
| `AUTH_TOKEN` | Токен авторизации в панель | — (обязательно) |
| `AGENT_TOKEN` | Токен для MTG Agent | `mtg-agent-secret` |
| `AGENT_PORT` | Порт агента | `8081` |
| `PORT` | Порт панели | `3000` |

### Агент (`.env` в `/opt/mtg-agent/`)

| Переменная | Описание | По умолчанию |
|-----------|----------|-------------|
| `AGENT_TOKEN` | Токен авторизации | `mtg-agent-secret` |

---

## Обновление

### Панель

```bash
cd /opt/mtg-adminpanel
git pull origin main
docker cp backend/src/app.js mtg-panel:/app/src/app.js
docker cp backend/src/ssh.js mtg-panel:/app/src/ssh.js
docker cp public/index.html mtg-panel:/app/public/index.html
docker restart mtg-panel
```

Или полный перезапуск:
```bash
docker compose down && docker compose up -d
```

### Агент на нодах

Через панель: ✏️ ноды → **Обновить** в секции MTG Agent.

---

## Changelog

### v2.0.0 (2026-03-15)

**Новое:**
- MTG Agent — HTTP агент на каждой ноде для точных метрик в реальном времени
- Лимит устройств на клиента с автоматическим стопом при превышении
- Автосброс трафика (ежедневно / ежемесячно / ежегодно)
- Накопленный трафик за всё время в базе данных
- Страница каждой ноды с детальной статистикой
- Флаги стран высокого разрешения (flagcdn.com w80)
- Флаг в заголовке страницы клиентов
- Онлайн-пиллы на дашборде и карточках нод
- Кнопка установки/обновления агента в настройках ноды

**Исправлено:**
- Подсчёт подключений через `/proc/{pid}/net/tcp6` — точные данные для bridge network
- IPv4 форсирование для HTTP запросов к агенту
- Убраны IIFE в JSX (несовместимы с Babel standalone)
- Дублирующий `</main>` тег
- Оператор `??` заменён на тернарный (Babel standalone 7.23)
- `process.env` в браузерном коде

**v1.x → v2.0 breaking changes:**
- `agent_port` добавлен в таблицу `nodes` (миграция автоматическая)
- `max_devices`, `traffic_reset_interval`, `next_reset_at`, `total_traffic_rx_bytes`, `total_traffic_tx_bytes` добавлены в таблицу `users`

---

## Лицензия

MIT

---

## FastAPI test mode (ветка `mtg-test`)

В этой ветке добавлен отдельный сервис `services/control-api` (FastAPI), чтобы протестировать переход вживую без удаления текущего Express backend.

### Запуск FastAPI варианта

```bash
git checkout mtg-test
docker compose -f docker-compose.fastapi.yml up -d --build
# FastAPI test UI: http://server:3001
```

После запуска FastAPI тест-контур доступен на `http://server:3001`, а API работает через FastAPI (`/api/*`).

### Что уже перенесено

- `GET /api/version`
- `GET/POST/PUT/DELETE /api/nodes`
- `GET /api/nodes/:id/check`
- `GET/POST /api/nodes/:id/users`
- `GET /api/status`
- `TOTP`: `/api/totp/status`, `/api/totp/setup`, `/api/totp/verify`, `/api/totp/disable`

> Это тестовый контур для live-проверки архитектуры. Дальше можно поэтапно переносить SSH/agent операции и тяжелые маршруты из `backend/src/app.js`.
