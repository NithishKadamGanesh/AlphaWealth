FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV HF_HOME=/root/.cache/huggingface
ENV TRANSFORMERS_CACHE=/root/.cache/huggingface

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3.11 python3.11-dev python3-pip \
    gcc g++ git \
    && rm -rf /var/lib/apt/lists/*

RUN ln -sf /usr/bin/python3.11 /usr/bin/python && \
    ln -sf /usr/bin/python3.11 /usr/bin/python3

WORKDIR /app

COPY requirements.txt .
# PyTorch with CUDA 12.1
RUN pip install --no-cache-dir torch==2.2.0 --index-url https://download.pytorch.org/whl/cu121 && \
    pip install --no-cache-dir -r requirements.txt

COPY fingpt_service.py .

# Note: FinGPT model itself is downloaded on first inference (~13GB total for base + LoRA)
# Cached in /root/.cache/huggingface volume

EXPOSE 8098
CMD ["python", "fingpt_service.py"]
