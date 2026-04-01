import React from 'react';

const PrivacyPolicy = () => {
  return (
    <div className="min-h-screen bg-gray-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto bg-white p-8 rounded-lg shadow-md">
        <h1 className="text-3xl font-bold text-gray-900 mb-6 text-center">Política de Privacidade</h1>
        
        <div className="prose prose-lg text-gray-700 max-w-none">
          <p><strong>Última atualização:</strong> {new Date().toLocaleDateString('pt-BR')}</p>

          <h2 className="text-2xl font-semibold mt-8 mb-4">1. Introdução</h2>
          <p>
            Bem-vindo ao AtendAI ("nós", "nosso"). Estamos empenhados em proteger a sua privacidade. Esta Política de Privacidade explica como recolhemos, usamos, divulgamos e salvaguardamos as suas informações quando utiliza a nossa aplicação de atendimento inteligente.
          </p>

          <h2 className="text-2xl font-semibold mt-8 mb-4">2. Recolha de Informações</h2>
          <p>
            Recolhemos informações para fornecer um serviço de IA eficiente. As informações incluem:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li><strong>Dados de Conta:</strong> E-mail e credenciais fornecidas no registo.</li>
            <li><strong>Integração Google Drive:</strong> Com a sua permissão, acedemos ao seu Google Drive exclusivamente para que a IA possa consultar documentos e enviar arquivos de mídia (fotos, catálogos, vídeos) aos seus clientes via WhatsApp.</li>
            <li><strong>Integração Google Calendar:</strong> Acedemos à sua agenda para verificar disponibilidade e agendar reuniões solicitadas pelos seus clientes durante a conversa com a IA.</li>
            <li><strong>Dados de Conversa:</strong> Armazenamos o histórico de mensagens do WhatsApp para que a IA mantenha o contexto e para a sua gestão no painel administrativo.</li>
          </ul>

          <h2 className="text-2xl font-semibold mt-8 mb-4">3. Uso das Suas Informações</h2>
          <p>
            Usamos as informações recolhidas para:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>Operar e manter o agente de IA ativo.</li>
            <li>Personalizar as respostas da IA com base nos seus documentos do Drive.</li>
            <li>Automatizar o agendamento de compromissos na sua agenda.</li>
            <li>Melhorar a precisão dos modelos de linguagem utilizados.</li>
          </ul>

          <h2 className="text-2xl font-semibold mt-8 mb-4">4. Divulgação e Segurança</h2>
          <p>
            Não vendemos os seus dados. As informações das APIs do Google são usadas estritamente para as funcionalidades que você ativar. Utilizamos encriptação para proteger tokens de acesso e dados sensíveis em nossa base de dados.
          </p>

          <h2 className="text-2xl font-semibold mt-8 mb-4">5. Serviços de Terceiros</h2>
          <p>
            O AtendAI utiliza a API do WhatsApp Business (Meta) e os serviços de IA do Google Gemini. O uso destes serviços está sujeito às políticas de privacidade de seus respectivos provedores.
          </p>

          <h2 className="text-2xl font-semibold mt-8 mb-4">6. Contato</h2>
          <p>
            Se tiver dúvidas sobre esta Política, entre em contato em:
            <br />
            <span className="font-semibold">desenvolvimento@cjssolucoes.com</span>
          </p>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;