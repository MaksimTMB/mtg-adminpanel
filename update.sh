#!/bin/bash
cd /tmp

INSTALL_DIR="/opt/mtg-adminpanel"

echo "▶ Обновление MTG AdminPanel..."

if [ ! -d "$INSTALL_DIR" ]; then
    echo "❌ Панель не установлена. Запусти install.sh"
    exit 1
fi

if [ ! -d "$INSTALL_DIR/.git" ]; then
    echo "❌ Директория не является git репозиторием. Переустанови панель."
    exit 1
fi

cd "$INSTALL_DIR"
git pull
docker compose up -d --build
echo "✅ Панель обновлена!"
echo "$(docker ps | grep mtg-panel)"
