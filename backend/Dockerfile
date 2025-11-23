# Use uma imagem base oficial do Python
FROM python:3.11-slim

# Define o diretório de trabalho
WORKDIR /app

# Variável de ambiente para o Python
ENV PYTHONUNBUFFERED 1

# Instala dependências do sistema
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libpq-dev ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# --- MUDANÇA AQUI ---
# Copia o requirements.txt (que está no mesmo nível do Dockerfile)
COPY ./requirements.txt /app/requirements.txt

# Instala as dependências
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# --- MUDANÇA AQUI ---
# Copia TUDO (incluindo app/, main.py, etc.) para /app
COPY . /app/

# Define um CMD padrão (sem alterações)
CMD ["echo", "Nenhum comando especificado. A imagem foi construída, mas não iniciou nenhum processo."]