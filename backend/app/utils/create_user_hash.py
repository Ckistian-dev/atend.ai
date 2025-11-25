from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def generate_hash():
    """
    Pede ao usuário uma senha e imprime o hash correspondente.
    """
    plain_password = input("Digite a senha que você quer usar para o login: ")
    
    if not plain_password:
        print("\n❌ A senha não pode ser vazia.")
        return

    hashed_password = get_password_hash(plain_password)
    
    print("\n" + "="*50)
    print("✅ HASH GERADO COM SUCESSO!")
    print("Copie a linha abaixo (sem as aspas) e cole na coluna 'senha' da sua planilha:")
    print("\n" + hashed_password)
    print("="*50 + "\n")


if __name__ == "__main__":
    generate_hash()
