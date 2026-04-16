import React from 'react';
import { Shield, Lock, Database, Cloud, Users, Mail, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const Section = ({ number, title, icon: Icon, children }) => (
    <div className="group relative">
        <div className="flex items-start gap-5">
            <div className="flex-shrink-0 w-10 h-10 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 flex items-center justify-center shadow-lg shadow-blue-500/20 mt-0.5">
                <Icon size={18} className="text-white" />
            </div>
            <div className="flex-1 pb-8 border-b border-slate-100 last:border-0">
                <div className="flex items-center gap-3 mb-3">
                    <span className="text-xs font-bold text-blue-500 tracking-widest uppercase">{String(number).padStart(2, '0')}</span>
                    <h2 className="text-lg font-bold text-slate-800">{title}</h2>
                </div>
                <div className="text-slate-600 leading-relaxed text-sm space-y-3">{children}</div>
            </div>
        </div>
    </div>
);

const PrivacyPolicy = () => {
    const navigate = useNavigate();
    return (
        <div className="min-h-screen" style={{ background: 'linear-gradient(135deg, #f0f4ff 0%, #e8eeff 50%, #f0f4ff 100%)' }}>
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;700;800&family=Inter:wght@400;500;600&display=swap');
                .policy-page { font-family: 'Inter', sans-serif; }
                .policy-page h1, .policy-page h2 { font-family: 'Plus Jakarta Sans', sans-serif; }
            `}</style>

            <div className="policy-page max-w-3xl mx-auto py-16 px-6">
                {/* Back button */}
                <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-sm text-slate-500 hover:text-blue-600 mb-10 transition-colors group">
                    <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
                    Voltar
                </button>

                {/* Header */}
                <div className="text-center mb-14">
                    <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-600 text-xs font-semibold uppercase tracking-widest mb-5">
                        <Shield size={12} />
                        Documento Legal
                    </div>
                    <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight mb-3">
                        Política de Privacidade
                    </h1>
                    <p className="text-slate-500 text-sm">
                        Última atualização: <strong>{new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</strong>
                    </p>
                </div>

                {/* Card */}
                <div className="bg-white rounded-3xl shadow-xl shadow-slate-200/80 border border-slate-100 p-8 md:p-12">
                    <div className="space-y-0">
                        <Section number={1} title="Introdução" icon={Shield}>
                            <p>
                                Bem-vindo ao <strong className="text-slate-800">AtendAI</strong> ("nós", "nosso"). Estamos empenhados em proteger a sua privacidade. Esta Política de Privacidade explica como recolhemos, usamos, divulgamos e salvaguardamos as suas informações quando utiliza a nossa aplicação de atendimento inteligente.
                            </p>
                        </Section>

                        <Section number={2} title="Recolha de Informações" icon={Database}>
                            <p>Recolhemos informações para fornecer um serviço de IA eficiente. As informações incluem:</p>
                            <ul className="space-y-2.5 mt-3">
                                {[
                                    { label: 'Dados de Conta', desc: 'E-mail e credenciais fornecidas no registo.' },
                                    { label: 'Integração Google Drive', desc: 'Com a sua permissão, acedemos ao seu Google Drive exclusivamente para que a IA possa consultar documentos e enviar arquivos de mídia (fotos, catálogos, vídeos) aos seus clientes via WhatsApp.' },
                                    { label: 'Integração Google Calendar', desc: 'Acedemos à sua agenda para verificar disponibilidade e agendar reuniões solicitadas pelos seus clientes durante a conversa com a IA.' },
                                    { label: 'Dados de Conversa', desc: 'Armazenamos o histórico de mensagens do WhatsApp para que a IA mantenha o contexto e para a sua gestão no painel administrativo.' },
                                ].map((item, i) => (
                                    <li key={i} className="flex items-start gap-3 p-3 rounded-xl bg-slate-50">
                                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 flex-shrink-0" />
                                        <span><strong className="text-slate-700">{item.label}:</strong> {item.desc}</span>
                                    </li>
                                ))}
                            </ul>
                        </Section>

                        <Section number={3} title="Uso das Suas Informações" icon={Users}>
                            <p>Usamos as informações recolhidas para:</p>
                            <ul className="space-y-2 mt-3">
                                {[
                                    'Operar e manter o agente de IA ativo.',
                                    'Personalizar as respostas da IA com base nos seus documentos do Drive.',
                                    'Automatizar o agendamento de compromissos na sua agenda.',
                                    'Melhorar a precisão dos modelos de linguagem utilizados.',
                                ].map((item, i) => (
                                    <li key={i} className="flex items-center gap-2.5 text-slate-600">
                                        <span className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                        </span>
                                        {item}
                                    </li>
                                ))}
                            </ul>
                        </Section>

                        <Section number={4} title="Divulgação e Segurança" icon={Lock}>
                            <p>
                                Não vendemos os seus dados. As informações das APIs do Google são usadas estritamente para as funcionalidades que você ativar. Utilizamos encriptação para proteger tokens de acesso e dados sensíveis em nossa base de dados.
                            </p>
                        </Section>

                        <Section number={5} title="Serviços de Terceiros" icon={Cloud}>
                            <p>
                                O AtendAI utiliza a API do WhatsApp Business (Meta) e os serviços de IA do Google Gemini. O uso destes serviços está sujeito às políticas de privacidade de seus respectivos provedores.
                            </p>
                        </Section>

                        <Section number={6} title="Contato" icon={Mail}>
                            <p>Se tiver dúvidas sobre esta Política, entre em contato em:</p>
                            <a href="mailto:desenvolvimento@cjssolucoes.com" className="inline-flex items-center gap-2 mt-2 px-4 py-2 rounded-xl bg-blue-50 border border-blue-100 text-blue-700 font-semibold text-sm hover:bg-blue-100 transition-colors">
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

export default PrivacyPolicy;