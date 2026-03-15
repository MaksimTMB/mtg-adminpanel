"""
MTG Agent — лёгкий HTTP агент для каждой ноды.
Читает метрики MTG контейнеров через Docker SDK и отдаёт через REST API.
Порт: 8081 (внутри docker сети)
"""
import os
import re
from fastapi import FastAPI, HTTPException, Header
from fastapi.responses import JSONResponse
import docker

app = FastAPI(title="MTG Agent", version="1.0.0")

# Простой токен для защиты от случайного доступа
AGENT_TOKEN = os.environ.get("AGENT_TOKEN", "mtg-agent-secret")

client = docker.from_env()


def get_mtg_containers():
    """Получить все MTG контейнеры (имя начинается с mtg-)"""
    try:
        return [c for c in client.containers.list(all=True) if c.name.startswith("mtg-") and c.name != "mtg-agent"]
    except Exception:
        return []


def get_connections(container) -> int:
    """
    Считать активные соединения к контейнеру.
    Контейнер в bridge network — получаем его внутренний IP,
    затем считаем соединения на хосте к этому IP:3128.
    """
    try:
        # Получаем внутренний IP контейнера
        container.reload()
        networks = container.attrs.get("NetworkSettings", {}).get("Networks", {})
        container_ip = None
        for net in networks.values():
            ip = net.get("IPAddress")
            if ip:
                container_ip = ip
                break

        if not container_ip:
            return 0

        # Запускаем ss на хосте (через host network) и фильтруем по IP контейнера
        result = client.containers.run(
            "alpine",
            f"sh -c 'apk add -q iproute2 2>/dev/null; ss -tn dst {container_ip}:3128 | grep -v Netid | wc -l'",
            remove=True,
            network_mode="host",
            stdout=True,
            stderr=False,
        )
        return max(0, int(result.decode().strip()) - 1)  # -1 за строку заголовка
    except Exception:
        return 0


def get_traffic(container) -> dict:
    """Получить трафик rx/tx через docker stats (один снапшот)"""
    try:
        stats = container.stats(stream=False)
        rx = stats.get("networks", {})
        total_rx = sum(v.get("rx_bytes", 0) for v in rx.values())
        total_tx = sum(v.get("tx_bytes", 0) for v in rx.values())

        def fmt(b: int) -> str:
            if b >= 1_073_741_824:
                return f"{b / 1_073_741_824:.2f}GB"
            if b >= 1_048_576:
                return f"{b / 1_048_576:.2f}MB"
            if b >= 1024:
                return f"{b / 1024:.2f}KB"
            return f"{b}B"

        return {"rx": fmt(total_rx), "tx": fmt(total_tx), "rx_bytes": total_rx, "tx_bytes": total_tx}
    except Exception:
        return {"rx": "—", "tx": "—", "rx_bytes": 0, "tx_bytes": 0}


@app.get("/health")
def health():
    return {"status": "ok", "version": "1.0.0"}


@app.get("/metrics")
def metrics(x_agent_token: str = Header(default="")):
    if x_agent_token != AGENT_TOKEN:
        raise HTTPException(status_code=401, detail="Unauthorized")

    containers = get_mtg_containers()
    result = []

    for c in containers:
        name = c.name  # mtg-admin, mtg-liza, etc.
        running = c.status == "running"

        connections = get_connections(c) if running else 0
        traffic = get_traffic(c) if running else {"rx": "—", "tx": "—", "rx_bytes": 0, "tx_bytes": 0}

        result.append({
            "name": name,
            "running": running,
            "status": c.status,
            "connections": connections,
            "is_online": connections > 0,
            "traffic": traffic,
        })

    return JSONResponse({"containers": result, "total": len(result)})
