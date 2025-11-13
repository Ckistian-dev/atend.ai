# Dockerfile

# 1. Estágio de Build: Instalar dependências
FROM python:3.11-slim as builder

WORKDIR /app

# Instala dependências do sistema, se necessário (ex: para compilar psycopg2)
# RUN apt-get update && apt-get install -y build-essential libpq-dev

COPY backend/requirements.txt .

# Instala as dependências em um ambiente virtual dentro do builder
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
RUN pip install --no-cache-dir -r requirements.txt

# 2. Estágio Final: Imagem leve com as dependências instaladas
FROM python:3.11-slim

WORKDIR /app

# Copia o ambiente virtual do estágio de build
COPY --from=builder /opt/venv /opt/venv

# Copia o código da sua aplicação
COPY backend/ .

# Define o ambiente virtual como o padrão
ENV PATH="/opt/venv/bin:$PATH"

# Expõe a porta que o FastAPI vai usar
EXPOSE 8000
