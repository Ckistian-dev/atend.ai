# Use uma imagem base oficial do Python
FROM python:3.11-slim

# Define o diretório de trabalho dentro do contêiner
WORKDIR /app

# Instala o ffmpeg usando o gerenciador de pacotes do sistema (apt)
RUN apt-get update && apt-get install -y ffmpeg

# Copia o arquivo de dependências primeiro para aproveitar o cache
COPY requirements.txt .

# Instala as dependências do Python
RUN pip install --no-cache-dir -r requirements.txt

# Copia o restante do código da sua aplicação
COPY . .

# -----------------
# A CORREÇÃO ESTÁ AQUI
# -----------------

# 1. Diga ao Elastic Beanstalk que seu app roda na porta 8000
EXPOSE 8000

# 2. Inicie o Uvicorn manualmente na porta 8000
CMD uvicorn app.main:app --host 0.0.0.0 --port 8000