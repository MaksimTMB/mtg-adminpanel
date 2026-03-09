# 🔒 MTG AdminPanel

Веб-панель для управления MTProto прокси ([mtg v2](https://github.com/9seconds/mtg)) на нескольких серверах через SSH.

![Stack](https://img.shields.io/badge/Node.js-20-green) ![Docker](https://img.shields.io/badge/Docker-Compose-blue) ![SQLite](https://img.shields.io/badge/DB-SQLite-lightgrey) ![License](https://img.shields.io/badge/License-MIT-yellow) ![Version](https://img.shields.io/badge/version-1.5.0-cyan)

---

## Возможности

- 🖥️ Управление несколькими нодами из одного интерфейса
- ➕ Добавление нод через веб — SSH пароль или ключ
- 👥 Создание юзеров с уникальной ссылкой `tg://proxy`
- 🔄 **Синхронизация юзеров** — импорт существующих юзеров с ноды в панель одной кнопкой
- 📱 QR-код для каждого юзера — открой и отсканируй прямо в панели
- 📊 Трафик входящий/исходящий по каждому юзеру
- 📈 График подключений за последние 24 часа
- ⏱️ Дата истечения доступа с автоудалением по расписанию
- 🚦 Лимит трафика на юзера
- 📝 Заметка к юзеру (например "Иван, оплатил до 01.04")
- ✏️ Редактирование юзера без пересоздания
- ⏸️ Остановка / запуск отдельных юзеров
- 🔗 Копирование ссылки одним кликом
- 📋 Единая таблица всех юзеров со всех нод
- 🔐 Двухфакторная аутентификация (TOTP / Google Authenticator)
- 📱 Адаптивный интерфейс для мобильных устройств

---

## ⚡ Установка

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/MaksimTMB/mtg-adminpanel/main/install.sh)
```

Скрипт задаст несколько вопросов и всё настроит автоматически:
- Установит Docker (если не установлен)
- Скачает панель
- Спросит токен, порт, нужен ли SSL
- Настроит Nginx + Let's Encrypt (по желанию)
- Настроит автозапуск

---

## 🗑️ Удаление

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/MaksimTMB/mtg-adminpanel/main/uninstall.sh)
```

---

## Требования

**Сервер панели:**
- Ubuntu 20+ / Debian 11+
- Docker + Docker Compose

**Ноды:**
- Docker + Docker Compose
- Открытые порты 4433+ (TCP) в файрволе / Security Group
- Если SSH user не root — добавить в группу docker: `usermod -aG docker <user>`

---

## Ручная установка

### Вариант 1 — HTTP (без домена)

```bash
git clone https://github.com/MaksimTMB/mtg-adminpanel.git /opt/mtg-adminpanel
cd /opt/mtg-adminpanel
cp .env.example .env
nano .env            # укажи AUTH_TOKEN
mkdir -p data ssh_keys
docker compose up -d --build
```

Панель: `http://<IP>:3000`

---

### Вариант 2 — HTTPS через Nginx

```bash
git clone https://github.com/MaksimTMB/mtg-adminpanel.git /opt/mtg-adminpanel
cd /opt/mtg-adminpanel
cp .env.example .env && nano .env
mkdir -p data ssh_keys
docker compose up -d --build

# Nginx + SSL (панель будет на порту 8443, т.к. 443 может быть занят)
apt install -y nginx certbot python3-certbot-nginx
certbot --nginx -d proxy.yourdomain.com
```

Панель: `https://proxy.yourdomain.com:8443`

---

### Вариант 3 — С Nginx Proxy Manager (NPM)

```bash
git clone https://github.com/MaksimTMB/mtg-adminpanel.git /opt/mtg-adminpanel
cd /opt/mtg-adminpanel
cp .env.example .env && nano .env
mkdir -p data ssh_keys
docker compose up -d --build
```

В NPM добавь Proxy Host:

| Поле | Значение |
|------|----------|
| Domain | `proxy.yourdomain.com` |
| Forward Host | IP сервера |
| Forward Port | `8443` |
| Force SSL | ✅ |

---

## Настройка .env

```env
AUTH_TOKEN=your-secret-token   # токен для входа в панель
PORT=3000                      # порт панели
DATA_DIR=/data                 # путь к базе данных
```

---

## 🔐 Двухфакторная аутентификация

1. Открой панель → **Настройки**
2. Нажми **Включить 2FA**
3. Отсканируй QR-код в Google Authenticator (или любом TOTP-приложении)
4. Введи 6-значный код для подтверждения
5. При следующем входе после токена появится второй шаг с вводом кода

> Реализовано на встроенном Node.js `crypto` — без внешних зависимостей.

---

## Добавление ноды

1. Открой панель → **Ноды** → **Добавить ноду**
2. Заполни: название, Host / IP, SSH User, SSH Port, пароль или ключ
3. Нажми **Ping** — убедись что нода онлайн ✅
4. Кликни на строку ноды → **Добавить юзера**

### Требования к ноде
- Docker + Docker Compose
- Открытый порт `4433+` TCP в файрволе
- Если пользователь не root: `usermod -aG docker <user>`

---

## Управление контейнером

```bash
docker logs mtg-panel -f                                             # логи
docker restart mtg-panel                                             # перезапуск
cd /opt/mtg-adminpanel && docker compose down                        # остановка
cd /opt/mtg-adminpanel && git pull && docker compose up -d --build  # обновление
```

---

## Структура проекта

```
mtg-adminpanel/
├── install.sh          # скрипт установки
├── uninstall.sh        # скрипт удаления
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── backend/
│   └── src/
│       ├── app.js      # Express API
│       ├── db.js       # SQLite
│       ├── ssh.js      # SSH управление нодами
│       └── totp.js     # TOTP 2FA (без зависимостей)
├── public/
│   └── index.html      # React SPA
├── data/               # БД (в .gitignore)
└── ssh_keys/           # ключи (в .gitignore)
```

---

## API

Все запросы: заголовок `x-auth-token: <AUTH_TOKEN>`

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/nodes` | Список нод |
| POST | `/api/nodes` | Добавить ноду |
| PUT | `/api/nodes/:id` | Редактировать ноду |
| DELETE | `/api/nodes/:id` | Удалить ноду |
| GET | `/api/nodes/:id/check` | Ping ноды |
| GET | `/api/nodes/:id/traffic` | Трафик юзеров |
| GET | `/api/nodes/:id/users` | Список юзеров |
| POST | `/api/nodes/:id/users` | Добавить юзера |
| PUT | `/api/nodes/:id/users/:name` | Редактировать юзера |
| DELETE | `/api/nodes/:id/users/:name` | Удалить юзера |
| POST | `/api/nodes/:id/users/:name/stop` | Остановить |
| POST | `/api/nodes/:id/users/:name/start` | Запустить |
| GET | `/api/nodes/:id/users/:name/history` | История подключений |
| GET | `/api/status` | Статус всех нод |
| GET | `/api/totp/status` | Статус 2FA |
| POST | `/api/totp/setup` | Настроить 2FA |
| POST | `/api/totp/verify` | Включить 2FA |
| POST | `/api/totp/disable` | Отключить 2FA |

---

## Лицензия

MIT © [MaksimTMB](https://github.com/MaksimTMB)
