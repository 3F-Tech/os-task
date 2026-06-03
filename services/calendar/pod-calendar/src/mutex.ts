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
const LOCK_STALE_MS = 2 * 60_000

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
