FROM python:3.12-slim

# Unbuffered so uvicorn's logs reach `docker compose logs` as they happen
# rather than sitting in a pipe buffer until the process exits.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Requirements first: this layer is cached until the file itself changes,
# so ordinary code edits skip the slow pip install entirely.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN useradd --create-home --uid 10001 app && chown -R app /app
USER app

EXPOSE 8000

# --host 0.0.0.0, not the default loopback: inside a container, loopback is
# only reachable from within the container itself, so the healthcheck and
# every other service would see a refused connection.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
