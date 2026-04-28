import tagSharing from '@hcengineering/tag-sharing'

// All component/string/icon IDs are already defined in the base plugin.
// Re-exporting as-is avoids the `identify overwrites` error that mergeIds
// would throw when keys already exist in the base namespace.
export default tagSharing
