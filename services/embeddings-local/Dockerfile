FROM python:3.12.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 TRANSFORMERS_OFFLINE=1 HF_HUB_OFFLINE=1
WORKDIR /service
COPY requirements.txt .
RUN pip install --no-cache-dir torch==2.8.0 --index-url https://download.pytorch.org/whl/cpu \
    && pip install --no-cache-dir -r requirements.txt
COPY app.py .
USER 65532:65532
EXPOSE 8090
CMD ["uvicorn","app:app","--host","0.0.0.0","--port","8090","--workers","1"]
