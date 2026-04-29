# F04 — Ciclo PDCA — Casos de Teste

## Pré-condições

- Projeto configurado com os campos `Ciclo PDCA Ativo` (Boolean) e `Frequência do Ciclo` (Dropdown: Semanal / Quinzenal / Mensal)
- Usuário logado com papel de Member ou superior no projeto

---

## TC-04-01 — Ativar ciclo PDCA em uma issue

**Pré-condição:** Issue `[CLIENTE] Ciclo PDCA de Comunicação` existe no projeto Seed - Performance

**Passos:**
1. Abrir a issue
2. Localizar o campo `Ciclo PDCA Ativo` e marcar como `true`
3. Definir `Frequência do Ciclo` = `Semanal`
4. Salvar

**Resultado esperado:**
- Campo `Ciclo PDCA Ativo = true` salvo na issue
- Campo `Frequência do Ciclo = Semanal` salvo
- Nenhuma issue nova criada ainda (o ciclo só dispara no próximo período)

---

## TC-04-02 — Validação: PDCA ativo sem frequência definida

**Passos:**
1. Abrir uma issue
2. Marcar `Ciclo PDCA Ativo = true`
3. Deixar `Frequência do Ciclo` vazio
4. Tentar salvar ou mudar de status

**Resultado esperado:**
- Sistema exibe alerta: "Frequência do Ciclo é obrigatória quando Ciclo PDCA está ativo"
- Não permite salvar / alterar status sem preencher a frequência

---

## TC-04-03 — Criação automática de issue ao início do ciclo semanal

**Pré-condição:** Issue com `Ciclo PDCA Ativo = true` e `Frequência = Semanal` existe

**Passos:**
1. Aguardar ou simular virada de semana (Domingo → Segunda)
2. Verificar no projeto se nova issue foi criada

**Resultado esperado:**
- Nova issue criada no mesmo projeto com título `[CLIENTE] Ciclo PDCA de Comunicação — Semana {nº}`
- Responsável, componente, prioridade e estimativa herdados
- `Ciclo PDCA Ativo = true` e `Frequência = Semanal` mantidos
- `Spent time = 0`, sem subtarefas
- Responsável recebeu notificação de nova tarefa

---

## TC-04-04 — Criação automática de issue ao início do ciclo mensal

**Pré-condição:** Issue com `Ciclo PDCA Ativo = true` e `Frequência = Mensal`

**Passos:**
1. Aguardar ou simular virada de mês (1º dia do mês)
2. Verificar no projeto

**Resultado esperado:**
- Nova issue criada com título `[CLIENTE] Relatório Mensal — {Mês} {Ano}`
- Herdou campos corretos
- Subtarefas NÃO foram copiadas

---

## TC-04-05 — Issue pai concluída não gera novo ciclo

**Passos:**
1. Issue com PDCA ativo está no status Done/Finalizado
2. Aguardar ou simular virada de ciclo

**Resultado esperado:**
- Nenhuma nova issue criada para essa issue
- Issues em status activo continuam gerando normalmente

---

## TC-04-06 — Desativar ciclo PDCA

**Passos:**
1. Abrir issue com `Ciclo PDCA Ativo = true`
2. Desmarcar `Ciclo PDCA Ativo` (= false)
3. Salvar
4. Simular virada de ciclo

**Resultado esperado:**
- Nenhuma nova issue criada para essa issue após desativar
- Issues geradas anteriormente permanecem intactas

---

## TC-04-07 — Issue gerada automaticamente é independente (não é sub-issue)

**Passos:**
1. Verificar issue criada automaticamente pelo ciclo

**Resultado esperado:**
- Issue não aparece como sub-issue da issue original
- `attachedTo` está vazio (não vinculada como subtarefa)
- Aparece como issue independente na lista do projeto

---

## TC-04-08 — Nomenclatura correta por frequência

| Frequência | Exemplo de título esperado |
|---|---|
| Semanal | `[SEED] Ciclo PDCA de Comunicação — Semana 18` |
| Quinzenal | `[SEED] Ciclo PDCA de Comunicação — Quinzena 1 de Maio` |
| Mensal | `[SEED] Relatório Mensal — Maio 2026` |

**Passos:**
1. Criar issues com cada frequência
2. Simular virada de cada ciclo
3. Verificar título gerado

**Resultado esperado:** Título segue exatamente o formato acima

---

## TC-04-09 — Notificação ao responsável

**Passos:**
1. Issue com PDCA ativo, responsável = `joao@seed.com.br`
2. Simular criação automática de ciclo
3. Logar como `joao@seed.com.br`

**Resultado esperado:**
- Notificação na caixa de entrada: "Nova issue de ciclo PDCA criada: [título]"
- Notificação no Planner do usuário aparece com a nova issue

---

## Cenários de regressão

- [ ] Issues sem `Ciclo PDCA Ativo` não são afetadas pela lógica do scheduler
- [ ] Performance: criar 50 issues com PDCA ativo não degrada o sistema na virada do ciclo
- [ ] Dois ciclos simultâneos no mesmo projeto não geram duplicatas
