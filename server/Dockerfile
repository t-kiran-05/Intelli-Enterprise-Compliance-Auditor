FROM python:3.11-slim

WORKDIR /app

# Install dependencies first (layer caching)
COPY server/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy shared audit modules
COPY server/audit_core.py .
COPY server/checklists.json .
COPY server/audit_service.py .
COPY server/main.py .

EXPOSE 8000

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
