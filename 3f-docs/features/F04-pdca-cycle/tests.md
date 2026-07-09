# F04 — Ciclo PDCA — Casos de Teste

## Pré-condições

- Issue com os campos `pdcaCycleActive`, `pdcaCycleFrequency` e `pdcaCycleResetStatus` configurados (campos reais do modelo `Issue`)
- Pod `worker` rodando (executa `services/worker/src/pdca.ts`)
- Usuário logado com papel de Member ou superior no projeto

---

## TC-04-01 — Ativar ciclo PDCA em uma issue

**Pré-condição:** Issue `[CLIENTE] Ciclo PDCA de Comunicação` existe no projeto Seed - Performance

**Passos:**
1. Abrir a issue
2. Marcar `pdcaCycleActive = true`
3. Definir `pdcaCycleFrequency = Weekly`
4. Definir `pdcaCycleResetStatus` (ex: "A fazer")
5. Salvar

**Resultado esperado:**
- Campos PDCA salvos na issue
- `pdcaNextCycleDate` calculado para a próxima segunda-feira
- Nenhuma issue nova criada (o ciclo só dispara na virada)

---

## TC-04-02 — Ciclo semanal reseta a tarefa in-place (modo padrão)

**Pré-condição:** Issue com `pdcaCycleActive = true`, `pdcaCycleFrequency = Weekly`, `pdcaCycleDuplicate = false` (ou ausente), com tempo gasto lançado e status avançado

**Passos:**
1. Aguardar ou simular virada de semana (segunda-feira à meia-noite)
2. Verificar a MESMA issue

**Resultado esperado:**
- **Nenhuma issue nova** é criada
- Título permanece o mesmo (sem sufixo "Semana N")
- `status` volta para `pdcaCycleResetStatus`
- `reportedTime` = 0 (tempo gasto zerado)
- `startDate` atualizada para o momento do reset; `completedDate` = null
- `dueDate` recalculada a partir da frequência
- Um comentário de snapshot com o estado do ciclo anterior é adicionado

---

## TC-04-03 — Modo duplicate cria nova tarefa e mantém a original

**Pré-condição:** Issue com `pdcaCycleActive = true`, `pdcaCycleDuplicate = true`, `pdcaCycleFrequency = Weekly`

**Passos:**
1. Aguardar ou simular virada de ciclo (segunda-feira)
2. Verificar o projeto

**Resultado esperado:**
- Uma **nova issue** é criada no mesmo projeto, **reutilizando o MESMO título** da original (sem sufixo "Semana N")
- A nova issue tem número/identifier próprios, `reportedTime = 0`, `startDate` = agora, `dueDate` do ciclo, e herda responsável, prioridade, componente, estimativa, `clientName`/`clientStage` e a config PDCA
- A **issue original é mantida**, marcada como concluída (categoria Won) e com `pdcaCycleActive = false`
- A original não dispara novos ciclos

---

## TC-04-04 — Ciclo mensal (reset in-place)

**Pré-condição:** Issue com `pdcaCycleActive = true`, `pdcaCycleFrequency = Monthly`

**Passos:**
1. Aguardar ou simular virada de mês (1º dia do mês)
2. Verificar a issue

**Resultado esperado:**
- Mesma issue resetada in-place (status/tempo/datas), sem criação de nova tarefa (modo padrão)
- Título inalterado

---

## TC-04-05 — Issue não configurada / concluída não gera ciclo

**Passos:**
1. Issue com `pdcaCycleActive = false` OU sem `pdcaCycleFrequency`/`pdcaCycleResetStatus`
2. Aguardar ou simular virada de ciclo

**Resultado esperado:**
- Nenhum reset nem criação de issue (o worker ignora issues não totalmente configuradas)

---

## TC-04-06 — Desativar ciclo PDCA

**Passos:**
1. Abrir issue com `pdcaCycleActive = true`
2. Desmarcar `pdcaCycleActive` (= false)
3. Salvar
4. Simular virada de ciclo

**Resultado esperado:**
- Nenhum reset nem nova issue após desativar
- Tarefas/duplicatas geradas anteriormente permanecem intactas

---

## TC-04-07 — Reset/recriação de sub-issues (`pdcaCycleResetSubIssues`)

**Passos:**
1. Issue PDCA com sub-issues diretas e `pdcaCycleResetSubIssues = true`
2. Simular virada de ciclo

**Resultado esperado:**
- **Modo reset in-place:** as sub-issues diretas são resetadas in-place (status → reset status, tempo zerado, `startDate` renovada, `completedDate` limpa); o `dueDate` próprio da sub-issue não é recalculado
- **Modo duplicate:** as sub-issues diretas são **recriadas** sob a nova issue (resetadas ao status de reset); as sub-issues originais permanecem anexadas à issue já concluída
- Com `pdcaCycleResetSubIssues = false`, as sub-issues não são tocadas

---

## TC-04-08 — Frequência semanal reseta na SEGUNDA-FEIRA

**Passos:**
1. Issue com `pdcaCycleFrequency = Weekly`
2. Inspecionar `pdcaNextCycleDate` após configurar / após uma virada

**Resultado esperado:**
- A próxima virada cai sempre na **segunda-feira** à meia-noite (não domingo)

---

## TC-04-09 — Idempotência contra redelivery Kafka

**Passos:**
1. Issue PDCA em modo duplicate na virada
2. Forçar reentrega da mesma mensagem Kafka (ou simular redelivery)

**Resultado esperado:**
- Apenas **uma** virada é aplicada; o guard de dedup por `pdcaNextCycleDate` ignora a reentrega
- Não são criadas cópias duplicadas (regressão dos "ghost issues")

---

## Cenários de regressão

- [ ] Issues sem `pdcaCycleActive` não são afetadas pelo worker
- [ ] Modo padrão NUNCA cria issue nova nem sufixo de título
- [ ] Modo duplicate reutiliza o mesmo título e mantém a original (Won + inativa)
- [ ] Weekly sempre vira na segunda-feira
- [ ] Redelivery de mensagem não gera cópias (watermark `pdcaNextCycleDate`)
