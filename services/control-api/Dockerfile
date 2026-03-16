FROM python:3.11-slim

WORKDIR /app

COPY services/control-api/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY services/control-api/app /app/app
COPY public /app/public

EXPOSE 3000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "3000"]
