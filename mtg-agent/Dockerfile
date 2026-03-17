FROM python:3.12-alpine
RUN pip install --no-cache-dir fastapi uvicorn docker pydantic
WORKDIR /app
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8081"]
