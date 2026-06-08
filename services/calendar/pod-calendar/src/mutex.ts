import { WorkspaceUuid } from '@hcengineering/core'

export const synced = new Set<WorkspaceUuid>()

interface LockEntry {
  promise: Promise<void>
  acquiredAt: number
}

const locks = new Map<string, LockEntry>()

// Why: locks abandonados por callers que travaram no meio do sync (Google
// API stuck, websocket dropped, throw fora do try/finally) bloqueavam todos
// os syncs futuros daquele user até restart do container. Cap a espera em
// 2 min — qualquer sync legítimo termina antes — e força evicção do lock
// stale em vez de pendurar indefinidamente.
export const LOCK_STALE_MS = 2 * 60_000

export async function lock (key: string): Promise<() => void> {
  const current = locks.get(key)
  if (current != null) {
    const winner = await Promise.race([
      current.promise.then(() => 'released' as const),
      new Promise<'stale'>((resolve) => setTimeout(() => resolve('stale'), LOCK_STALE_MS))
    ])
    if (winner === 'stale') {
      const heldFor = Date.now() - current.acquiredAt
      console.warn(`[mutex] force-evicting stale lock: key=${key} heldFor=${heldFor}ms`)
      if (locks.get(key) === current) {
        locks.delete(key)
      }
    }
  }

  let releaseFn!: () => void
  const promise = new Promise<void>((resolve) => {
    releaseFn = resolve
  })
  const entry: LockEntry = { promise, acquiredAt: Date.now() }
  locks.set(key, entry)

  return () => {
    if (locks.get(key) === entry) {
      locks.delete(key)
    }
    releaseFn()
  }
}

// Checa se uma key está atualmente bloqueada (sem esperar). Útil para
// fluxos disparados pelo usuário (ex: botão de force sync) que devem
// responder "busy" rápido em vez de pendurar até o lock liberar.
export function isLocked (key: string): boolean {
  return locks.has(key)
}

// Retorna há quanto tempo o lock dessa key está adquirido, em ms.
// null se a key não tem lock. Usado para detectar stale sem entrar no
// race do lock() — útil em handlers de UI que precisam decidir entre
// "destrava e prossegue" e "responde busy".
export function getLockAge (key: string): number | null {
  const entry = locks.get(key)
  if (entry === undefined) return null
  return Date.now() - entry.acquiredAt
}

// Remove um lock à força. Use só quando o caller já decidiu (via getLockAge
// + threshold) que o lock está stale, ou em handler administrativo. Não
// resolve a Promise da entry original — quem detinha o lock continua
// achando que tem, mas qualquer novo lock(key) vai poder adquirir.
export function evictLock (key: string): boolean {
  return locks.delete(key)
}

// Evict todos os locks de um workspace (user-locks `${ws}:${userId}:${email}`
// e `outcoming:${ws}`). Usado pelo endpoint admin que destrava workspace
// inteiro sem restart do pod.
export function evictLocksForWorkspace (workspace: string): string[] {
  const evicted: string[] = []
  const outcomingKey = `outcoming:${workspace}`
  for (const key of Array.from(locks.keys())) {
    if (key === outcomingKey || key.startsWith(`${workspace}:`)) {
      if (locks.delete(key)) {
        evicted.push(key)
      }
    }
  }
  return evicted
}

// Debug aid: lista locks vivos com tempo de retenção. Quando algum sync
// pendura, em vez de restartar o pod cego dá pra inspecionar qual key
// está travada e há quanto tempo via GET /admin/locks.
export function getActiveLocks (): Array<{ key: string, heldForMs: number }> {
  const now = Date.now()
  return Array.from(locks.entries()).map(([key, entry]) => ({
    key,
    heldForMs: now - entry.acquiredAt
  }))
}
