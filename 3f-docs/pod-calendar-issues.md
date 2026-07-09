# Relatório de Investigação: Travamentos no pod-calendar

> **Nota (2026-07):** as severidades de esgotamento de CPU descritas aqui foram medidas na
> **VPS antiga de 2 núcleos**. Após o upgrade para **Hostinger KVM4 (4 núcleos / 16 GB)** em
> **2026-07-02**, o impacto é mais brando — mas os problemas estruturais e os fixes abaixo
> **seguem válidos**.

Este relatório documenta os principais problemas arquiteturais encontrados no serviço de calendário (`pod-calendar`) que causam travamentos (hangs/freezes) e vazamentos de recursos no ambiente de produção (VPS).

O serviço não parece sofrer de erros de sintaxe que forçam o encerramento da aplicação (crash), mas sim de gargalos graves de concorrência e loops lógicos que esgotam o Event Loop e a memória do Node.js, exigindo reinicialização manual.

## Pontos de Atenção Críticos

### 1. Falha de Concorrência no Mutex (`mutex.ts`)
A implementação customizada de controle de concorrência (`mutex.ts`) possui uma falha lógica crítica em cenários de múltiplos acessos simultâneos (por exemplo, quando vários webhooks chegam ao mesmo tempo para o mesmo usuário).
- **Problema:** Quando uma "trava" (lock) é liberada, todas as requisições que estavam em espera (`Promise.race`) acordam ao mesmo tempo. Ao invés de uma fila ordenada, todas elas prosseguem simultaneamente e sobrescrevem a posse do lock no `Map`. 
- **Impacto:** Isso anula o propósito do Mutex. Sincronizações pesadas rodam em paralelo, o estado de controle é corrompido, e o serviço entra em **Deadlock**, prendendo usuários e estourando a utilização de RAM e CPU.

### 2. Timers Presos na Limitação de Taxa (`rateLimiter.ts`)
O mecanismo de limite de chamadas à API do Google (Rate Limiting) pode se tornar um gargalo letal sob alta demanda (agravado pela falha do Mutex).
- **Problema:** O método `take(count)` utiliza um `while` com pausas baseadas em `setTimeout` para aguardar a reposição de "tokens" da API.
- **Impacto:** Quando centenas de requisições paralelas exigem tokens, cria-se uma explosão de temporizadores simultâneos e atrasados no Event Loop do Node.js. Isso sufoca o processo, impedindo-o de responder a novas requisições da rede.

### 3. Vazamento de Conexões e Timers (`client.ts`)
A tentativa de controle de "Conexões Zumbis" com o banco (Transactor) deixa lixo na memória.
- **Problema:** A função `withTimeout` aplica um timeout de segurança (ex: 30 segundos), mas ela **não limpa (`clearTimeout`)** o timer interno se a conexão for estabelecida com sucesso antes do limite.
- **Impacto:** Cada vez que o sistema reconecta ou processa clientes rapidamente, temporizadores ociosos são deixados acumulando na memória (Memory Leak de baixo impacto, mas perigoso no longo prazo), além de dificultar o trabalho do Garbage Collector.

### 4. Risco de Loop Infinito (`sync.ts`)
A sincronização bidirecional do calendário possui um comportamento perigoso ao lidar com tokens invalidados pelo Google.
- **Problema:** Na função `eventsSync`, caso a API retorne um erro `410 Gone` (token de sincronização desatualizado), o código invoca recursivamente a si próprio.
- **Impacto:** Se houver um estado anômalo onde o Google continue retornando sempre `410`, a função ficará em loop infinito chamando a si mesma (Call Stack), monopolizando a CPU e bloqueando o processo inteiro.

## Recomendações
1. **Refatorar o Mutex:** Substituir a implementação manual de `mutex.ts` por uma biblioteca amplamente testada pela comunidade, como `async-mutex`.
2. **Sanitizar Timers:** Garantir a remoção explícita de temporizadores com `clearTimeout` na função `withTimeout` no arquivo `client.ts`.
3. **Limitar a Recursividade:** Adicionar um contador ou um mecanismo de freio ao tratamento de erros `410` em `sync.ts` para evitar recursividade infinita.
