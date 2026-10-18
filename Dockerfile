FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY careerlens ./careerlens
COPY static ./static
COPY examples ./examples
COPY knowledge ./knowledge
ENV CAREERLENS_DATA_DIR=/app/data
ENV CAREERLENS_MODE=ollama
ENV OLLAMA_URL=http://127.0.0.1:11434
CMD ["python", "-m", "uvicorn", "careerlens.app:create_app", "--factory", "--host", "127.0.0.1", "--port", "8000"]
