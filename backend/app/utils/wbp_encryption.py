from cryptography.fernet import Fernet
import os
from dotenv import load_dotenv # Descomente se precisar carregar do .env

load_dotenv()

# --- Cole suas chaves aqui ---
# Pegue do seu arquivo .env
ENCRYPTION_KEY = os.getenv('ENCRYPTION_KEY')
# Pegue do painel da Meta
PLAIN_WBP_TOKEN = input("Cole o token do painel da Meta e pressione Enter: ")
# -----------------------------

if len(ENCRYPTION_KEY) < 32:
    print("ERRO: Sua ENCRYPTION_KEY precisa ter 32 bytes ou mais.")
else:
    try:
        cipher_suite = Fernet(ENCRYPTION_KEY)
        encrypted_token_bytes = cipher_suite.encrypt(PLAIN_WBP_TOKEN.encode())
        encrypted_token_string = encrypted_token_bytes.decode()

        print("Copie este valor e cole na coluna 'wbp_access_token' do banco de dados:")
        print(encrypted_token_string)

    except Exception as e:
        print(f"Erro ao criptografar: {e}")