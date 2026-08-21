# Regra de Reinicialização de Contêineres Docker

Sempre que arquivos do backend (`backend/app/...`, `backend/Dockerfile`, etc.) forem criados ou alterados durante qualquer tarefa/conversa, você DEVE reiniciar os contêineres Docker correspondentes que foram afetados (por exemplo: `atendai_api`, `atendai_worker_agent`, `atendai_worker_webhook`, `atendai_worker_bulk_sender`, `atendai_worker_integrations`, `atendai_worker_followup`) antes de concluir a resposta para o usuário.
