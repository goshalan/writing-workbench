FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    WRITING_WORKBENCH_DIR=/data/manuscripts \
    WRITING_WORKBENCH_HOST=0.0.0.0 \
    WRITING_WORKBENCH_PORT=8000

WORKDIR /app

RUN addgroup --system workbench \
    && adduser --system --ingroup workbench --home /nonexistent --no-create-home workbench

COPY pyproject.toml README.md LICENSE ./
COPY writing_workbench ./writing_workbench

RUN pip install --no-cache-dir . \
    && mkdir -p /data/manuscripts \
    && chown -R workbench:workbench /data

USER workbench

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=2)"]

CMD ["writing-workbench"]
