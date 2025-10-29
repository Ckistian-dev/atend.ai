from cryptography.fernet import Fernet
import os
from dotenv import load_dotenv # Descomente se precisar carregar do .env

load_dotenv()

# --- Cole suas chaves aqui ---
# Pegue do seu arquivo .env
ENCRYPTION_KEY = os.getenv('ENCRYPTION_KEY')
# Pegue do painel da Meta
PLAIN_WBP_TOKEN = 'EAALMh6uKOfABPwv7h5t3paxN5lhJdFWVmU0mg4aWPCUW1qoLiVHmKFqtqIWYXEdWGObZBfyo3QSBBbnqtpZBZA6ZApiQ7u0ReddKZAxfsINm8HVSsc4gGYhVM9EZAalcmqyzWx5tr8pXUUcEhrZBLdZBuoDgVlk6rngA8j7lm01lctPkWdznhjL14ZBAjflyDuu6x4QZDZD'
# -----------------------------

if len(ENCRYPTION_KEY) < 32:
    print("ERRO: Sua ENCRYPTION_KEY precisa ter 32 bytes ou mais.")
else:
    try:
        cipher_suite = Fernet(ENCRYPTION_KEY)
        encrypted_token_bytes = cipher_suite.encrypt(PLAIN_WBP_TOKEN.encode())
        encrypted_token_string = encrypted_token_bytes.decode()

        print("\n--- TOKEN CRIPTOGRAFADO ---")
        print("Copie este valor e cole na coluna 'wbp_access_token' do banco de dados:")
        print(encrypted_token_string)
        print("---------------------------\n")

    except Exception as e:
        print(f"Erro ao criptografar: {e}")