#!/bin/bash
cd /tmp  # ensure valid working directory from the start
set +H  # отключаем history expansion (для токенов со спецсимволами)

# ============================================================
#  MTG AdminPanel — Install Script
#  https://github.com/MaksimTMB/mtg-adminpanel
# ============================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
DIM='\033[2m'
NC='\033[0m'

INSTALL_DIR="/opt/mtg-adminpanel"

print_header() {
    clear
    echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${WHITE}      🔒  MTG AdminPanel — Installer             ${NC}${CYAN}║${NC}"
    echo -e "${CYAN}║${DIM}      https://github.com/MaksimTMB/mtg-adminpanel ${NC}${CYAN}║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
    echo ""
}

print_step() {
    echo -e "${CYAN}▶ $1${NC}"
}

print_ok() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_warn() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# ── Проверка root ────────────────────────────────────────────
if [ "$EUID" -ne 0 ]; then
    print_error "Запусти скрипт от root: sudo bash install.sh"
    exit 1
fi

print_header

# ── Сбор переменных ──────────────────────────────────────────
echo -e "${WHITE}Настройка MTG AdminPanel${NC}"
echo -e "${DIM}Ответь на несколько вопросов для установки.${NC}"
echo ""

# AUTH_TOKEN
while true; do
    echo -ne "${WHITE}Токен авторизации${NC} ${DIM}(придумай пароль для входа в панель)${NC}: "
    IFS= read -r AUTH_TOKEN < /dev/tty
    if [ ${#AUTH_TOKEN} -ge 6 ]; then
        break
    else
        print_warn "Токен должен быть минимум 6 символов"
    fi
done

# PORT
echo -ne "${WHITE}Порт панели${NC} ${DIM}[3000]${NC}: "
IFS= read -r PORT_INPUT < /dev/tty
PORT=${PORT_INPUT:-3000}

# SSL
echo ""
echo -e "${WHITE}Нужен ли SSL?${NC}"
echo -e "  ${CYAN}[1]${NC} Нет — только HTTP (http://IP:$PORT)"
echo -e "  ${CYAN}[2]${NC} Да — через Nginx + Let's Encrypt (нужен домен)"
echo -ne "  Выбор ${DIM}[1]${NC}: "
IFS= read -r SSL_CHOICE < /dev/tty
SSL_CHOICE=${SSL_CHOICE:-1}

DOMAIN=""
EMAIL=""
if [ "$SSL_CHOICE" == "2" ]; then
    echo -ne "${WHITE}Домен${NC} ${DIM}(например proxy.yourdomain.com)${NC}: "
    IFS= read -r DOMAIN < /dev/tty
    echo -ne "${WHITE}Email${NC} ${DIM}(для Let's Encrypt)${NC}: "
    IFS= read -r EMAIL < /dev/tty
fi

# ── Подтверждение ────────────────────────────────────────────
echo ""
echo -e "${DIM}────────────────────────────────────────────────────${NC}"
echo -e "${WHITE}Параметры установки:${NC}"
echo -e "  Директория:  ${CYAN}$INSTALL_DIR${NC}"
echo -e "  Порт:        ${CYAN}$PORT${NC}"
echo -e "  Auth Token:  ${CYAN}$AUTH_TOKEN${NC}"
if [ "$SSL_CHOICE" == "2" ]; then
    echo -e "  Домен:       ${CYAN}$DOMAIN${NC}"
    echo -e "  Email:       ${CYAN}$EMAIL${NC}"
fi
echo -e "${DIM}────────────────────────────────────────────────────${NC}"
echo ""
echo -ne "${WHITE}Начать установку? (y/N)${NC}: "
IFS= read -r CONFIRM < /dev/tty
if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
    echo -e "${DIM}Отменено.${NC}"
    exit 0
fi

echo ""

# ── Обновление системы ───────────────────────────────────────
print_step "Обновление системы..."
DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq
print_ok "Система обновлена"

# ── Установка зависимостей ───────────────────────────────────
print_step "Установка зависимостей..."
apt-get install -y -qq curl wget git unzip
print_ok "Зависимости установлены"

# ── Установка Docker ─────────────────────────────────────────
if ! command -v docker &> /dev/null; then
    print_step "Установка Docker..."
    curl -fsSL https://get.docker.com | sh
    print_ok "Docker установлен"
else
    print_ok "Docker уже установлен ($(docker --version | cut -d' ' -f3 | tr -d ','))"
fi

# ── Клонирование репозитория ─────────────────────────────────
print_step "Загрузка MTG AdminPanel..."
if [ -d "$INSTALL_DIR" ]; then
    if [ -d "$INSTALL_DIR/.git" ]; then
        print_warn "Директория $INSTALL_DIR уже существует — обновляем..."
        cd "$INSTALL_DIR" && git pull -q
    else
        print_warn "Директория $INSTALL_DIR существует но не является git репо — переустанавливаем..."
        rm -rf "$INSTALL_DIR"
        git clone -q https://github.com/MaksimTMB/mtg-adminpanel.git "$INSTALL_DIR"
    fi
else
    git clone -q https://github.com/MaksimTMB/mtg-adminpanel.git "$INSTALL_DIR"
fi
print_ok "Репозиторий загружен"

# ── Создание .env ────────────────────────────────────────────
print_step "Создание конфигурации..."
mkdir -p "$INSTALL_DIR/data" "$INSTALL_DIR/ssh_keys"

cat > "$INSTALL_DIR/.env" << EOF
AUTH_TOKEN=$AUTH_TOKEN
PORT=$PORT
DATA_DIR=/data
EOF

print_ok "Конфигурация создана"

# ── Запуск Docker Compose ────────────────────────────────────
print_step "Запуск панели..."
cd "$INSTALL_DIR"
docker compose up -d --build 2>&1 | tail -5
sleep 3

if docker ps | grep -q mtg-panel; then
    print_ok "Панель запущена"
else
    print_error "Ошибка запуска! Проверь: docker logs mtg-panel"
    exit 1
fi

# ── Настройка Nginx + SSL ────────────────────────────────────
if [ "$SSL_CHOICE" == "2" ] && [ -n "$DOMAIN" ]; then

    print_step "Установка Nginx..."
    apt-get install -y -qq nginx
    print_ok "Nginx установлен"

    print_step "Получение SSL сертификата для $DOMAIN..."
    apt-get install -y -qq certbot python3-certbot-nginx

    # Временный конфиг для certbot
    cat > "/etc/nginx/sites-available/mtg-panel" << EOF
server {
    listen 80;
    server_name $DOMAIN;
    location / { return 200 'ok'; }
}
EOF
    ln -sf /etc/nginx/sites-available/mtg-panel /etc/nginx/sites-enabled/
    nginx -t -q && systemctl reload nginx

    certbot certonly --nginx -d "$DOMAIN" --email "$EMAIL" --agree-tos --non-interactive -q

    if [ $? -eq 0 ]; then
        print_ok "SSL сертификат получен"

        # Финальный конфиг Nginx
        cat > "/etc/nginx/sites-available/mtg-panel" << EOF
server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$host\$request_uri;
}

server {
    listen 8443 ssl;
    server_name $DOMAIN;

    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    location / {
        proxy_pass http://localhost:$PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
        nginx -t -q && systemctl reload nginx
        print_ok "Nginx настроен с SSL"
    else
        print_warn "Не удалось получить SSL. Проверь что домен $DOMAIN указывает на этот сервер."
    fi
fi

# ── Автозапуск ───────────────────────────────────────────────
print_step "Настройка автозапуска..."
cat > /etc/systemd/system/mtg-adminpanel.service << EOF
[Unit]
Description=MTG AdminPanel
After=docker.service
Requires=docker.service

[Service]
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/docker compose up
ExecStop=/usr/bin/docker compose down
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable mtg-adminpanel -q
print_ok "Автозапуск настроен"

# ── Итог ─────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║${GREEN}           ✅  Установка завершена!              ${NC}${CYAN}║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
echo ""

if [ "$SSL_CHOICE" == "2" ] && [ -n "$DOMAIN" ]; then
    echo -e "  🌐 Панель:  ${CYAN}https://$DOMAIN:8443${NC}"
else
    IP=$(curl -s -4 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
    echo -e "  🌐 Панель:  ${CYAN}http://$IP:$PORT${NC}"
fi

echo -e "  🔑 Токен:   ${CYAN}$AUTH_TOKEN${NC}"
echo ""
echo -e "${DIM}  Управление:${NC}"
echo -e "  ${DIM}docker logs mtg-panel -f     — логи${NC}"
echo -e "  ${DIM}docker restart mtg-panel     — перезапуск${NC}"
echo -e "  ${DIM}cd $INSTALL_DIR && docker compose down  — остановка${NC}"
echo ""
