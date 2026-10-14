// New test-only import wrapper. Implementation comes unchanged from the pinned release bundle.
import type { StorageConstructor } from '../../src/role-storage.ts';
const Storage=(window as unknown as {TeRoleGraphStorage:StorageConstructor}).TeRoleGraphStorage;
if(typeof Storage!=='function') throw Error('Released TeRoleGraphStorage is unavailable');
export default Storage;
