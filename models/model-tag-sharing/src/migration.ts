import { tagSharingId } from '@hcengineering/tag-sharing'
import { tryMigrate, type MigrateOperation, type MigrationClient, type MigrationUpgradeClient } from '@hcengineering/model'

export const tagSharingOperation: MigrateOperation = {
  async migrate (client: MigrationClient, mode): Promise<void> {
    await tryMigrate(mode, client, tagSharingId, [])
  },
  async upgrade (state: Map<string, Set<string>>, client: () => Promise<MigrationUpgradeClient>): Promise<void> {}
}
