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

# Comando para iniciar sua aplicação, usando a porta que o Railway fornece
CMD uvicorn app.main:app --host 0.0.0.0 --port $PORT