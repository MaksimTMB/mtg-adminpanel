# MTG AdminPanel

Веб-панель управления MTG прокси серверами (Telegram MTPROTO proxy). Управляй несколькими нодами и клиентами через единый интерфейс с мониторингом в реальном времени.

![Version](https://img.shields.io/badge/version-2.3.1-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Docker](https://img.shields.io/badge/docker-required-blue)

---

## Быстрая установка

```bash
curl -fsSL https://raw.githubusercontent.com/MaksimTMB/mtg-adminpanel/main/install.sh | bash
```

Скрипт установит Docker, скачает панель, спросит токен и порт, настроит автозапуск. Опционально — SSL через Nginx + Let's Encrypt.

> Нужен root. На Ubuntu/Debian. Панель ставится в `/opt/mtg-adminpanel`.

---

## Установка агента на ноду

На каждую ноду нужно поставить лёгкий HTTP-агент (Python + FastAPI). Он считает уникальные IP и трафик в реальном времени через Docker API.

**Через панель** — кнопка «Установить агент» на странице ноды (рекомендуется).

**Вручную:**
```bash
curl -fsSL https://raw.githubusercontent.com/MaksimTMB/mtg-adminpanel/main/mtg-agent/install-agent.sh | bash -s -- YOUR_AGENT_TOKEN
```

Агент запустится на порту `8081`. Проверка:
```bash
curl -s -H 'x-agent-token: YOUR_AGENT_TOKEN' http://localhost:8081/health
```

---

## Обновление

```bash
curl -fsSL https://raw.githubusercontent.com/MaksimTMB/mtg-adminpanel/main/update.sh | bash
```

Или вручную:
```bash
cd /opt/mtg-adminpanel && git pull && docker compose up -d --build
```

---

## Удаление панели

```bash
curl -fsSL https://raw.githubusercontent.com/MaksimTMB/mtg-adminpanel/main/uninstall.sh | bash
```

Удаляет контейнер, директорию `/opt/mtg-adminpanel` с базой данных, systemd-сервис и Nginx-конфиг.

---

## Удаление агента и клиентов с ноды

Выполни на сервере ноды от `root`.

### Остановить и удалить агент

```bash
cd /opt/mtg-agent && docker compose down 2>/dev/null || true
rm -rf /opt/mtg-agent
```

### Удалить всех MTG клиентов (прокси-контейнеры)

```bash
docker ps -a --format '{{.Names}}' | grep '^mtg-' | xargs -r docker rm -f
rm -rf /opt/mtg
```

### Удалить Docker-образы MTG

```bash
docker images --format '{{.Repository}}:{{.Tag}}' | grep 'mtg' | xargs -r docker rmi -f
```

### Всё сразу — полная очистка ноды

```bash
cd /opt/mtg-agent && docker compose down 2>/dev/null || true
docker ps -a --format '{{.Names}}' | grep '^mtg-' | xargs -r docker rm -f
docker images --format '{{.Repository}}:{{.Tag}}' | grep 'mtg' | xargs -r docker rmi -f
rm -rf /opt/mtg-agent /opt/mtg
echo "Нода очищена."
```

---

## Возможности

### Управление нодами
- Добавление, редактирование, удаление нод
- SSH-подключение по паролю или приватному ключу
- Флаги стран для удобной навигации
- Проверка связи и статуса агента прямо из UI

### Управление клиентами
- Создание MTG-прокси контейнеров с автоназначением порта и секрета
- Запуск / остановка отдельных клиентов
- QR-коды и Telegram-ссылки для быстрого подключения
- Синхронизация существующих клиентов с удалённой нодой
- Массовый просмотр всех клиентов по всем нодам

### Мониторинг в реальном времени
- Трафик rx/tx за текущий период и за всё время
- Количество активных подключений (уникальные IP)
- **График подключений за 24 часа** — sparkline прямо в таблице
- Онлайн-статус из кэша (< 5 мс без задержки)

### Лимиты и автоматизация
- Лимит трафика в ГБ с автостопом при превышении
- Лимит одновременных устройств с автостопом
- Срок действия клиента с автостопом по истечении
- Автосброс трафика по расписанию: каждый день / месяц / год

### Безопасность
- Токен-авторизация
- Опциональный TOTP 2FA (Google Authenticator, Aegis, Authy)

### Интерфейс
- Тёмная и светлая тема
- Два языка: Русский и English
- Загрузка собственного логотипа в сайдбар
- Адаптивный дизайн — работает на мобильных

### MTG Agent
- Быстрый HTTP-агент на Python + FastAPI
- Считает уникальные IP через Docker API
- Установка в один клик из панели или через curl
- Обновление прямо из UI

---

## Требования

**Панель:** Docker + Docker Compose v2, открытый порт (по умолчанию 3000).

**Ноды:** Docker, SSH-доступ с сервера панели, контейнеры в `/opt/mtg/users/{name}/`, порт 8081 (для агента).

---

## Архитектура

```
┌──────────────────────────────┐
│   MTG AdminPanel (Docker)    │
│   React 18 + Node.js API     │
│   SQLite /data/*.db          │
└──────────┬───────────────────┘
           │ SSH + HTTP
    ┌──────┼──────────┐
    ▼      ▼          ▼
  Нода A  Нода B    Нода C
  Agent   Agent    (SSH)
  :8081   :8081
```

Кэш нод обновляется каждые **10 секунд** в фоне. Все API-запросы отвечают из кэша (< 5 мс).
История подключений записывается каждые **5 минут**, хранится **24 часа**.

---

## Переменные окружения

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `AUTH_TOKEN` | Пароль входа в панель | — (обязательно) |
| `PORT` | Порт панели | `3000` |
| `DATA_DIR` | Директория базы данных | `/data` |
| `AGENT_TOKEN` | Токен для MTG Agent | — (обязательно) |

Файл `.env` создаётся автоматически при установке через `install.sh`.

---

## Управление

```bash
docker logs mtg-panel -f          # логи в реальном времени
docker restart mtg-panel           # перезапуск
cd /opt/mtg-adminpanel
docker compose down                # остановить
docker compose up -d --build       # запустить / пересобрать
```

---

## Структура проекта

```
mtg-adminpanel/
├── backend/          # Node.js Express API + статика
│   ├── src/
│   │   ├── app.js        # маршруты и бизнес-логика
│   │   ├── db.js         # SQLite (better-sqlite3)
│   │   ├── nodeCache.js  # фоновый кэш нод (10 сек)
│   │   └── ssh.js        # SSH-клиент
│   └── public/           # скомпилированный фронтенд
├── frontend/         # React 18 + Vite SPA
│   └── src/
│       ├── AppContext.jsx    # глобальный стейт (тема, язык, логотип)
│       ├── i18n.js          # переводы RU / EN
│       └── components/      # страницы и модалки
├── mtg-agent/        # Python FastAPI агент для нод
├── install.sh        # интерактивный установщик
├── uninstall.sh      # удаление панели
├── update.sh         # обновление панели
└── docker-compose.yml
```

---

## Что нового в v2.3.1

- **Безопасность** — экранирование shell-аргументов в SSH-командах (защита от RCE)
- **Безопасность** — `/api/totp/setup` блокируется если 2FA уже включена
- **Безопасность** — токен принимается только через заголовок `x-auth-token`, из URL убран
- **Безопасность** — паника при запуске с `AUTH_TOKEN=changeme`
- **Исправление** — `PRAGMA foreign_keys = ON`: каскадное удаление теперь работает
- **Исправление** — нормализация дат из фронтенда, автостоп по сроку срабатывает точно
- `docker-compose.yml`: убраны небезопасные дефолты токенов

## Что нового в v2.3.0

- **Telegram-уведомления** — оповещения при автостопе клиента и изменении статуса ноды
- **Все клиенты** — отдельная страница с клиентами по всем нодам сразу
- **Поиск и фильтрация** — быстрый поиск клиентов по имени, ноде, статусу
- **Групповые действия** — старт / стоп / удаление нескольких клиентов сразу
- **Биллинг** — цена, валюта, период, статус оплаты, автостоп при просрочке
- **Экспорт** — выгрузка списка клиентов в CSV и JSON

## Что было в v2.2.0

- **График подключений** — sparkline за 24 часа в таблице клиентов
- **Светлая тема** — переключение тёмная / светлая в настройках
- **Английский язык** — выбор RU / EN в настройках
- **Логотип** — загрузка собственного логотипа в сайдбар
- **TOTP 2FA** — двухфакторная аутентификация (Google Authenticator, Aegis, Authy)

---

## API

Все защищённые эндпоинты требуют заголовок `x-auth-token: <AUTH_TOKEN>`.
Если включена 2FA — дополнительно `x-totp-session: <session>`.

### Публичные (без авторизации)

| Метод | Путь | Описание |
|-------|------|----------|
| `GET` | `/api/version` | Версия панели `{ version }` |
| `GET` | `/logo` | Логотип панели (PNG/JPG) |

### Аутентификация и 2FA

| Метод | Путь | Тело | Описание |
|-------|------|------|----------|
| `GET` | `/api/totp/status` | — | Статус 2FA `{ enabled }` |
| `POST` | `/api/totp/setup` | — | Генерирует секрет `{ secret, qr }` |
| `POST` | `/api/totp/verify` | `{ code }` | Подтверждает и включает 2FA |
| `POST` | `/api/totp/session` | `{ code }` | Создаёт сессию `{ session }` (TTL 24ч) |
| `POST` | `/api/totp/disable` | `{ code }` | Отключает 2FA |

### Настройки

| Метод | Путь | Тело | Описание |
|-------|------|------|----------|
| `POST` | `/api/settings/logo` | `{ data }` | Загружает логотип (base64 data URL) |
| `DELETE` | `/api/settings/logo` | — | Удаляет логотип |

### Ноды

| Метод | Путь | Тело | Описание |
|-------|------|------|----------|
| `GET` | `/api/nodes` | — | Список всех нод |
| `GET` | `/api/nodes/counts` | — | Кол-во клиентов по нодам `{ nodeId: count }` |
| `POST` | `/api/nodes` | `{ name, host, ssh_user, ssh_port, ssh_key\|ssh_password, base_dir, start_port, flag, agent_port }` | Добавить ноду |
| `PUT` | `/api/nodes/:id` | (те же поля) | Обновить ноду |
| `DELETE` | `/api/nodes/:id` | — | Удалить ноду |
| `GET` | `/api/nodes/:id/check` | — | Проверить SSH-соединение `{ online }` |
| `GET` | `/api/nodes/:id/summary` | — | Сводка ноды: статус + все клиенты + трафик |
| `GET` | `/api/nodes/:id/traffic` | — | Трафик по клиентам через SSH |
| `GET` | `/api/status` | — | Статус всех нод из кэша (мгновенно) |

### MTG Agent

| Метод | Путь | Описание |
|-------|------|----------|
| `GET` | `/api/nodes/:id/check-agent` | Проверить доступность агента `{ available }` |
| `POST` | `/api/nodes/:id/update-agent` | Обновить агент через SSH `{ ok, output }` |
| `GET` | `/api/nodes/:id/agent-version` | Версия агента из кэша `{ version, available }` |
| `GET` | `/api/nodes/:id/mtg-version` | Версия MTG-образа на ноде |
| `POST` | `/api/nodes/:id/mtg-update` | Обновить MTG-образ (`docker pull`) |

### Клиенты (Users)

| Метод | Путь | Тело | Описание |
|-------|------|------|----------|
| `GET` | `/api/nodes/:id/users` | — | Список клиентов ноды (из кэша, мгновенно) |
| `POST` | `/api/nodes/:id/users` | `{ name, note, expires_at, traffic_limit_gb }` | Создать клиента |
| `PUT` | `/api/nodes/:id/users/:name` | см. ниже | Обновить настройки клиента |
| `DELETE` | `/api/nodes/:id/users/:name` | — | Удалить клиента |
| `POST` | `/api/nodes/:id/users/:name/start` | — | Запустить прокси клиента |
| `POST` | `/api/nodes/:id/users/:name/stop` | — | Остановить прокси клиента |
| `POST` | `/api/nodes/:id/users/:name/reset-traffic` | — | Сбросить счётчик трафика |
| `GET` | `/api/nodes/:id/users/:name/history` | — | История подключений за 24ч (5-мин интервалы) |
| `POST` | `/api/nodes/:id/sync` | — | Синхронизировать клиентов с нодой `{ imported, total }` |

**Поля для `PUT /api/nodes/:id/users/:name`:**

```json
{
  "note": "string",
  "expires_at": "2025-12-31T00:00:00",
  "traffic_limit_gb": 10.0,
  "max_devices": 3,
  "traffic_reset_interval": "daily|monthly|yearly|null",
  "billing_price": 299.0,
  "billing_currency": "RUB|USD|EUR|USDT",
  "billing_period": "weekly|monthly|yearly",
  "billing_paid_until": "2025-12-31T00:00:00",
  "billing_status": "active|suspended|cancelled"
}
```

### Автоматизация (фон)

| Интервал | Действие |
|----------|----------|
| каждые 10 сек | Кэш нод: статус, клиенты, трафик, версия агента |
| каждые 5 мин | Запись истории подключений (хранится 24ч) |
| каждые 60 мин | Автостоп клиентов: истёкший срок ИЛИ просроченный биллинг |
| каждые 5 мин | Автосброс трафика (по расписанию клиента) |

---

## License

MIT

