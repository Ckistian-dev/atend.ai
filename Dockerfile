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

# --- Alteração para AWS + Railway ---

# 1. Expõe a porta 8000.
#    O AWS Elastic Beanstalk procura por esta linha.
#    O Railway vai ignorar esta linha, o que não tem problema.
EXPOSE 8000

# 2. Inicia o Uvicorn usando a variável $PORT (do Railway)
#    OU usa 8000 como padrão (para a AWS)
#    A sintaxe ${PORT:-8000} significa: "Use $PORT se estiver definida, senão, use 8000"
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]