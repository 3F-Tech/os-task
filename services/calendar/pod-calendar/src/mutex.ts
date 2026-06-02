import { WorkspaceUuid } from '@hcengineering/core'

export const synced = new Set<WorkspaceUuid>()

const locks = new Map<string, Promise<void>>()

export async function lock (key: string): Promise<() => void> {
  // Wait for any existing lock to be released
  const currentLock = locks.get(key)
  if (currentLock != null) {
    await currentLock
  }

  // Create a new lock
  let releaseFn!: () => void
  const newLock = new Promise<void>((resolve) => {
    releaseFn = resolve
  })

  // Store the lock
  locks.set(key, newLock)

  // Return the release function
  return () => {
    if (locks.get(key) === newLock) {
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
