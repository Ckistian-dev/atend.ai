import getpass
from passlib.context import CryptContext

# Define o contexto de criptografia, igual ao da aplicação.
# Isso garante que o hash gerado aqui será compatível com a verificação no login.
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def get_password_hash(password: str) -> str:
    """Gera o hash de uma senha usando bcrypt."""
    return pwd_context.hash(password)

def main():
    """
    Um script simples para gerar um hash bcrypt para a senha de admin.
    """
    try:
        print("Este script irá gerar um hash seguro para a sua senha de administrador.")
        password = getpass.getpass("Digite a nova senha de admin que deseja usar: ")
        
        if not password:
            print("\nA senha não pode ser vazia.")
            return

        # Confirmação de senha para evitar erros de digitação
        password_confirm = getpass.getpass("Confirme a senha: ")
        if password != password_confirm:
            print("\n❌ As senhas não coincidem. Tente novamente.")
            return

        hashed_password = get_password_hash(password)
        
        print("\n" + "="*50)
        print("✅ Hash gerado com sucesso!")
        print("Copie a linha abaixo e cole no seu arquivo .env:")
        print("="*50)
        print(f'ADMIN_PASSWORD="{hashed_password}"')
        print("="*50 + "\n")

    except Exception as e:
        print(f"\nOcorreu um erro inesperado: {e}")

if __name__ == "__main__":
    main()