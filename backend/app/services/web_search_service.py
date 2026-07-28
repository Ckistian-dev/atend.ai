import re
import logging
import httpx
from typing import Dict, Any, Optional
from html import unescape
from html.parser import HTMLParser

logger = logging.getLogger(__name__)


class SimpleHTMLTextExtractor(HTMLParser):
    """Extrator leve de texto limpo para HTML usando apenas a biblioteca padrão do Python."""
    def __init__(self):
        super().__init__()
        self.result = []
        self.skip_tags = {'script', 'style', 'head', 'title', 'meta', 'noscript', 'svg', 'button', 'nav', 'footer'}
        self.current_tag_stack = []

    def handle_starttag(self, tag, attrs):
        tag_lower = tag.lower()
        self.current_tag_stack.append(tag_lower)
        if tag_lower in ['p', 'br', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li']:
            self.result.append('\n')

    def handle_endtag(self, tag):
        if self.current_tag_stack:
            self.current_tag_stack.pop()
        tag_lower = tag.lower()
        if tag_lower in ['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li']:
            self.result.append('\n')

    def handle_data(self, data):
        if not self.current_tag_stack or not any(t in self.skip_tags for t in self.current_tag_stack):
            text = data.strip()
            if text:
                self.result.append(text)

    def get_text(self) -> str:
        text = "".join(self.result)
        # Limpa múltiplos saltos de linha e espaços
        text = re.sub(r'\n\s*\n', '\n', text)
        return unescape(text.strip())


def extrair_metatags_og(html_content: str) -> Dict[str, str]:
    """Extrai metadados OpenGraph e descrições do HTML (essencial para Instagram e redes sociais)."""
    meta_dict = {}

    # Procura por og:title, og:description, meta description, etc.
    og_patterns = [
        r'<meta\s+(?:property|name)=["\'](og:title|og:description|description|title|twitter:title|twitter:description)["\']\s+content=["\'](.*?)["\']',
        r'<meta\s+content=["\'](.*?)["\']\s+(?:property|name)=["\'](og:title|og:description|description|title|twitter:title|twitter:description)["\']'
    ]

    for pattern in og_patterns:
        matches = re.findall(pattern, html_content, re.IGNORECASE | re.DOTALL)
        for m in matches:
            if len(m) == 2:
                key, val = (m[0], m[1]) if 'og:' in m[0] or m[0] in ['description', 'title'] else (m[1], m[0])
                meta_dict[key.lower()] = unescape(val.strip())

    # Título da página
    title_match = re.search(r'<title>(.*?)</title>', html_content, re.IGNORECASE | re.DOTALL)
    if title_match:
        meta_dict['page_title'] = unescape(title_match.group(1).strip())

    return meta_dict


async def extrair_texto_bruto_url(url: str, timeout_seconds: int = 12) -> Dict[str, Any]:
    """
    Efetua a requisição HTTP para a URL informada e extrai os textos, metadados e legenda.
    Suporta links do Instagram (instagram.com / instagr.am) e páginas web em geral.
    """
    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "Cache-Control": "no-cache",
    }

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=timeout_seconds, headers=headers) as client:
            resp = await client.get(url)
            if resp.status_code >= 400:
                logger.warning(f"[WebSearch] Erro HTTP {resp.status_code} ao acessar {url}")
                return {
                    "sucesso": False,
                    "url": url,
                    "erro": f"Servidor retornou código HTTP {resp.status_code}"
                }

            html_raw = resp.text
            metas = extrair_metatags_og(html_raw)

            # Extração de texto do corpo
            parser = SimpleHTMLTextExtractor()
            parser.feed(html_raw)
            body_text = parser.get_text()

            # Monta síntese preliminar
            titulo = metas.get('og:title') or metas.get('page_title') or metas.get('title') or "Página Web"
            descricao = metas.get('og:description') or metas.get('description') or ""

            # Caso seja Instagram, a legenda principal fica no og:description ou og:title
            is_instagram = "instagram.com" in url or "instagr.am" in url
            
            # Limita tamanho máximo do texto para não exceder limites de token do Gemini
            texto_formatado = (
                f"URL: {url}\n"
                f"TÍTULO DA PÁGINA: {titulo}\n"
                f"META DESCRIÇÃO / LEGENDA: {descricao}\n\n"
                f"CONTEÚDO DA PÁGINA:\n{body_text[:4000]}"
            )

            return {
                "sucesso": True,
                "url": url,
                "is_instagram": is_instagram,
                "titulo": titulo,
                "descricao": descricao,
                "texto_bruto": texto_formatado
            }

    except Exception as e:
        logger.error(f"[WebSearch] Falha ao extrair URL {url}: {e}", exc_info=True)
        return {
            "sucesso": False,
            "url": url,
            "erro": f"Não foi possível acessar a URL: {str(e)}"
        }
