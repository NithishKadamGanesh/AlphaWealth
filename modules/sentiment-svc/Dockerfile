FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 python3.11-dev python3-pip \
    gcc g++ \
    && rm -rf /var/lib/apt/lists/*

RUN ln -sf /usr/bin/python3.11 /usr/bin/python && \
    ln -sf /usr/bin/python3.11 /usr/bin/python3

WORKDIR /app

COPY requirements.txt .
# Install PyTorch with CUDA 12.1 support first
RUN pip install --no-cache-dir torch==2.2.0 --index-url https://download.pytorch.org/whl/cu121 && \
    pip install --no-cache-dir -r requirements.txt

# Pre-download FinBERT
RUN python -c "from transformers import AutoTokenizer, AutoModelForSequenceClassification; \
    AutoTokenizer.from_pretrained('ProsusAI/finbert'); \
    AutoModelForSequenceClassification.from_pretrained('ProsusAI/finbert')"

COPY sentiment_service.py .

EXPOSE 8097
CMD ["python", "sentiment_service.py"]
