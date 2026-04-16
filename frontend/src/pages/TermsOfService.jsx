import React from 'react';
import { FileText, User, Brain, Link, CreditCard, AlertTriangle, Mail, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const Section = ({ number, title, icon: Icon, children }) => (
    <div className="group relative">
        <div className="flex items-start gap-5">
            <div className="flex-shrink-0 w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-700 flex items-center justify-center shadow-lg shadow-violet-500/20 mt-0.5">
                <Icon size={18} className="text-white" />
            </div>
            <div className="flex-1 pb-8 border-b border-slate-100 last:border-0">
                <div className="flex items-center gap-3 mb-3">
                    <span className="text-xs font-bold text-violet-500 tracking-widest uppercase">{String(number).padStart(2, '0')}</span>
                    <h2 className="text-lg font-bold text-slate-800">{title}</h2>
                </div>
                <div className="text-slate-600 leading-relaxed text-sm space-y-3">{children}</div>
            </div>
        </div>
    </div>
);

const TermsOfService = () => {
    const navigate = useNavigate();
    return (
        <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #f5f0ff 0%, #ede8ff 50%, #f5f0ff 100%)' }}>
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=Inter:wght@400;500;600&display=swap');
                .terms-page { font-family: 'Inter', sans-serif; }
                .terms-page h1, .terms-page h2 { font-family: 'Plus Jakarta Sans', sans-serif; }
            `}</style>

            <div className="terms-page max-w-3xl mx-auto py-16 px-6">
                {/* Back button */}
                <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-slate-500 hover:text-violet-600 mb-10 transition-colors group">
                    <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
                    Voltar
                </button>

                {/* Header */}
                <div className="text-center mb-14">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-violet-50 border border-violet-100 text-violet-600 text-xs font-semibold uppercase tracking-widest mb-5">
                        <FileText size={12} />
                        Documento Legal
                    </div>
                    <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight mb-3">
                        Termos de Serviço
                    </h1>
                    <p className="text-slate-500 text-sm">
                        Última atualização: <strong>{new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</strong>
                    </p>
                </div>

                {/* Card */}
                <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/80 border border-slate-100 p-8 md:p-12">
                    <div className="space-y-0">
                        <Section number={1} title="Aceitação dos Termos" icon={FileText}>
                            <p>
                                Ao utilizar o <strong className="text-slate-800">AtendAI</strong>, você concorda com estes termos. O serviço consiste em uma plataforma de automação de atendimento via WhatsApp utilizando Inteligência Artificial.
                            </p>
                        </Section>

                        <Section number={2} title="Responsabilidade do Usuário" icon={User}>
                            <p>
                                Você é o único responsável pelo conteúdo das mensagens enviadas pela IA e pela conformidade com as políticas do WhatsApp. O AtendAI é uma ferramenta de auxílio, e o uso indevido para envio de SPAM ou mensagens não solicitadas resultará no banimento da conta.
                            </p>
                            <div className="flex items-start gap-3 p-3 rounded-xl bg-amber-50 border border-amber-100 mt-3">
                                <AlertTriangle size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
                                <p className="text-amber-800 text-xs">O uso indevido para envio de SPAM violará as Políticas da Meta e resultará em banimento da conta de WhatsApp.</p>
                            </div>
                        </Section>

                        <Section number={3} title="Uso de Inteligência Artificial" icon={Brain}>
                            <p>
                                Você compreende que as respostas são geradas por modelos de IA (LLMs) e podem, ocasionalmente, conter imprecisões. Recomendamos a supervisão periódica dos atendimentos através do nosso painel de "Mensagens".
                            </p>
                        </Section>

                        <Section number={4} title="Integrações com Google" icon={Link}>
                            <p>
                                Ao conectar suas contas do Google Drive ou Calendar, você concede ao AtendAI as permissões necessárias para ler arquivos de contexto e gerir eventos de agenda em seu nome, conforme configurado na sua Persona.
                            </p>
                        </Section>

                        <Section number={5} title="Pagamentos e Créditos" icon={CreditCard}>
                            <p>
                                O uso do serviço está condicionado ao saldo de tokens ou plano contratado. Reservamo-nos o direito de interromper o processamento da IA caso o limite de uso seja atingido.
                            </p>
                        </Section>

                        <Section number={6} title="Limitação de Responsabilidade" icon={AlertTriangle}>
                            <p>
                                Não nos responsabilizamos por eventuais bloqueios de números de WhatsApp realizados pela Meta, uma vez que a operação do número é de responsabilidade do cliente.
                            </p>
                        </Section>

                        <Section number={7} title="Contato" icon={Mail}>
                            <p>Dúvidas sobre estes termos podem ser enviadas para:</p>
                            <a href="mailto:desenvolvimento@cjssolucoes.com" className="inline-flex items-center gap-2 mt-2 px-4 py-2 rounded-xl bg-violet-50 border border-violet-100 text-violet-700 font-semibold text-sm hover:bg-violet-100 transition-colors">
                                <Mail size={14} />
                                desenvolvimento@cjssolucoes.com
                            </a>
                        </Section>
                    </div>
                </div>

                <p className="text-center text-slate-400 text-xs mt-8">© {new Date().getFullYear()} AtendAI · Todos os direitos reservados</p>
            </div>
        </div>
    );
};

export default TermsOfService;