FROM python:3.11-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV HF_HOME=/root/.cache/huggingface
ENV TRANSFORMERS_CACHE=/root/.cache/huggingface

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir torch==2.2.2 && \
    pip install --no-cache-dir -r requirements.txt

COPY fingpt_service.py .

# Note: FinGPT model itself is downloaded on first inference (~13GB total for base + LoRA)
# Cached in /root/.cache/huggingface volume

EXPOSE 8098
CMD ["python", "fingpt_service.py"]
