import React from 'react';

const TermsOfService = () => {
  return (
    <div className="min-h-screen bg-gray-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto bg-white p-8 rounded-lg shadow-md">
        <h1 className="text-3xl font-bold text-gray-900 mb-6 text-center">Termos de Serviço</h1>

        <div className="prose prose-lg text-gray-700 max-w-none">
          <p><strong>Última atualização:</strong> {new Date().toLocaleDateString('pt-BR')}</p>

          <h2 className="text-2xl font-semibold mt-8 mb-4">1. Aceitação dos Termos</h2>
          <p>
            Ao utilizar o AtendAI, você concorda com estes termos. O serviço consiste em uma plataforma de automação de atendimento via WhatsApp utilizando Inteligência Artificial.
          </p>

          <h2 className="text-2xl font-semibold mt-8 mb-4">2. Responsabilidade do Usuário</h2>
          <p>
            Você é o único responsável pelo conteúdo das mensagens enviadas pela IA e pela conformidade com as políticas do WhatsApp. O AtendAI é uma ferramenta de auxílio, e o uso indevido para envio de SPAM ou mensagens não solicitadas resultará no banimento da conta.
          </p>

          <h2 className="text-2xl font-semibold mt-8 mb-4">3. Uso de Inteligência Artificial</h2>
          <p>
            Você compreende que as respostas são geradas por modelos de IA (LLMs) e podem, ocasionalmente, conter imprecisões. Recomendamos a supervisão periódica dos atendimentos através do nosso painel de "Mensagens".
          </p>

          <h2 className="text-2xl font-semibold mt-8 mb-4">4. Integrações com Google</h2>
          <p>
            Ao conectar suas contas do Google Drive ou Calendar, você concede ao AtendAI as permissões necessárias para ler arquivos de contexto e gerir eventos de agenda em seu nome, conforme configurado na sua Persona.
          </p>

          <h2 className="text-2xl font-semibold mt-8 mb-4">5. Pagamentos e Créditos</h2>
          <p>
            O uso do serviço está condicionado ao saldo de tokens ou plano contratado. Reservamo-nos o direito de interromper o processamento da IA caso o limite de uso seja atingido.
          </p>

          <h2 className="text-2xl font-semibold mt-8 mb-4">6. Limitação de Responsabilidade</h2>
          <p>
            Não nos responsabilizamos por eventuais bloqueios de números de WhatsApp realizados pela Meta, uma vez que a operação do número é de responsabilidade do cliente.
          </p>

          <h2 className="text-2xl font-semibold mt-8 mb-4">7. Contato</h2>
          <p>Dúvidas sobre estes termos podem ser enviadas para: desenvolvimento@cjssolucoes.com.</p>
        </div>
      </div>
    </div>
  );
};

export default TermsOfService;