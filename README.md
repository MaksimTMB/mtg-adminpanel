# MTG AdminPanel

Веб-панель управления MTG прокси серверами (Telegram MTPROTO proxy). Управляй несколькими нодами и клиентами через единый интерфейс с мониторингом в реальном времени.

![Version](https://img.shields.io/badge/version-2.1.0-blue)
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
# Остановить контейнер агента
cd /opt/mtg-agent && docker compose down 2>/dev/null || true

# Удалить файлы агента
rm -rf /opt/mtg-agent
```

### Удалить всех MTG клиентов (прокси-контейнеры)

```bash
# Остановить и удалить все контейнеры mtg-*
docker ps -a --format '{{.Names}}' | grep '^mtg-' | xargs -r docker rm -f

# Удалить все данные клиентов
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

| Функция | Описание |
|---------|----------|
| Управление нодами | Добавление, редактирование, удаление. SSH по паролю или ключу. Флаги стран |
| Управление клиентами | Создание/удаление MTG контейнеров, синхронизация, QR-коды, ссылки |
| Мониторинг | Трафик rx/tx, уникальные IP (устройства), онлайн-статус (кэш < 5 мс) |
| Лимиты | Лимит устройств, автосброс трафика (день/месяц/год), автостоп по сроку |
| Безопасность | Токен-авторизация, опциональный TOTP 2FA |
| MTG Agent | Быстрый сбор метрик без SSH. Установка одной кнопкой |

---

## Требования

**Панель:** Docker + Docker Compose v2, открытый порт (по умолчанию 3000).

**Ноды:** Docker, SSH-доступ с сервера панели, контейнеры в `/opt/mtg/users/{name}/`, порт 8081 (для агента).

---

## Архитектура

```
┌──────────────────────────────┐
│   MTG AdminPanel (Docker)    │
│   React SPA + Node.js API    │
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

---

## Переменные окружения

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `AUTH_TOKEN` | Пароль входа в панель | — (обязательно) |
| `PORT` | Порт панели | `3000` |
| `DATA_DIR` | Директория базы данных | `/data` |
| `AGENT_TOKEN` | Токен для MTG Agent | `mtg-agent-secret` |

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
│   ├── routes/       # API маршруты
│   ├── db.js         # SQLite (better-sqlite3)
│   ├── nodeCache.js  # кэш нод (10 сек)
│   └── sshClient.js  # SSH-клиент
├── frontend/         # React 18 + Vite SPA
│   └── src/
│       └── components/
├── mtg-agent/        # Python FastAPI агент для нод
├── install.sh        # интерактивный установщик
├── uninstall.sh      # удаление панели
├── update.sh         # обновление панели
└── docker-compose.yml
```

---

## License

MIT
