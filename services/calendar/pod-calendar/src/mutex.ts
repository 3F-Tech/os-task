import { WorkspaceUuid } from '@hcengineering/core'

export const synced = new Set<WorkspaceUuid>()

// Why: locks abandonados por callers que travaram no meio do sync (Google
// API stuck, websocket dropped, throw fora do try/finally) bloqueavam todos
// os syncs futuros daquele user até restart do container. Cap a espera em
// 2 min — qualquer sync legítimo termina antes — e força evicção do lock
// stale em vez de pendurar indefinidamente.
export const LOCK_STALE_MS = 2 * 60_000

interface ChainEntry {
  promise: Promise<void>
  acquiredAt: number
}

// Why: bug anterior — múltiplos callers awaitavam o MESMO `current.promise`
// e quando o holder soltava, todos resolviam juntos e cada um sobrescrevia
// `locks.set(key, ...)`. Resultado: dois ou mais "owners" simultâneos.
// Fix: cada novo caller captura o `tail` atual e o substitui pelo seu próprio
// entry ANTES de qualquer await. Assim cada caller espera o IMEDIATAMENTE
// anterior (e só ele), formando uma fila FIFO em vez de uma corrida.
//
// `heads` = caller que detém o lock agora (acquiredAt é hora de aquisição real).
// `tails` = último caller na fila (próximo a adquirir).
// Quando não há fila, head === tail.
const heads = new Map<string, ChainEntry>()
const tails = new Map<string, ChainEntry>()

export async function lock (key: string): Promise<() => void> {
  let releaseFn!: () => void
  const promise = new Promise<void>((resolve) => {
    releaseFn = resolve
  })
  const entry: ChainEntry = { promise, acquiredAt: 0 }

  const prev = tails.get(key)
  tails.set(key, entry)

  if (prev !== undefined) {
    let staleTimer: NodeJS.Timeout | undefined
    const winner = await Promise.race([
      prev.promise.then(() => 'released' as const),
      new Promise<'stale'>((resolve) => {
        staleTimer = setTimeout(() => resolve('stale'), LOCK_STALE_MS)
      })
    ])
    if (staleTimer !== undefined) clearTimeout(staleTimer)
    if (winner === 'stale') {
      const heldFor = prev.acquiredAt !== 0 ? Date.now() - prev.acquiredAt : 0
      console.warn(`[mutex] force-evicting stale lock: key=${key} heldFor=${heldFor}ms`)
    }
  }

  entry.acquiredAt = Date.now()
  heads.set(key, entry)

  return () => {
    // Identity check: só limpa se ainda somos o holder/tail. Stale eviction
    // ou evictLock administrativo podem ter transferido a posse.
    if (heads.get(key) === entry) heads.delete(key)
    if (tails.get(key) === entry) tails.delete(key)
    releaseFn()
  }
}

// Checa se uma key está atualmente bloqueada (sem esperar). Útil para
// fluxos disparados pelo usuário (ex: botão de force sync) que devem
// responder "busy" rápido em vez de pendurar até o lock liberar.
export function isLocked (key: string): boolean {
  return heads.has(key) || tails.has(key)
}

// Retorna há quanto tempo o lock dessa key está adquirido, em ms (a partir
// do holder atual). null se a key não tem lock. Usado para detectar stale
// sem entrar no race do lock() — útil em handlers de UI que precisam decidir
// entre "destrava e prossegue" e "responde busy".
export function getLockAge (key: string): number | null {
  const entry = heads.get(key)
  if (entry === undefined) return null
  return Date.now() - entry.acquiredAt
}

// Remove o head e tail de uma key à força. Use só quando o caller já decidiu
// (via getLockAge + threshold) que o lock está stale, ou em handler
// administrativo. Não resolve a Promise da entry original — quem detinha o
// lock continua achando que tem, mas qualquer novo lock(key) vai poder
// adquirir imediatamente (waiters existentes ainda esperam seus 2min do
// stale race).
export function evictLock (key: string): boolean {
  const had = heads.has(key) || tails.has(key)
  heads.delete(key)
  tails.delete(key)
  return had
}

// Evict todos os locks de um workspace (user-locks `${ws}:${userId}:${email}`
// e `outcoming:${ws}`). Usado pelo endpoint admin que destrava workspace
// inteiro sem restart do pod.
export function evictLocksForWorkspace (workspace: string): string[] {
  const evicted = new Set<string>()
  const outcomingKey = `outcoming:${workspace}`
  for (const key of Array.from(heads.keys())) {
    if (key === outcomingKey || key.startsWith(`${workspace}:`)) {
      heads.delete(key)
      evicted.add(key)
    }
  }
  for (const key of Array.from(tails.keys())) {
    if (key === outcomingKey || key.startsWith(`${workspace}:`)) {
      tails.delete(key)
      evicted.add(key)
    }
  }
  return Array.from(evicted)
}

// Debug aid: lista locks vivos com tempo de retenção. Quando algum sync
// pendura, em vez de restartar o pod cego dá pra inspecionar qual key
// está travada e há quanto tempo via GET /admin/locks.
export function getActiveLocks (): Array<{ key: string, heldForMs: number }> {
  const now = Date.now()
  return Array.from(heads.entries()).map(([key, entry]) => ({
    key,
    heldForMs: now - entry.acquiredAt
  }))
}
