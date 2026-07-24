import { BUILT_IN_ROLE_IDS, type Database } from '@phrasebook/db';
import type { Kysely, Transaction } from 'kysely';

/**
 * Last-Owner protection (M3 plan Phase A step 7, DoD #10): nobody can brick
 * their own instance by removing the final Owner. Enforced here, at the data
 * layer, so every mutation that can strip an Owner -- role revocation (step 8),
 * and any future user-lock or user-delete path -- goes through one chokepoint
 * instead of each re-deriving the rule.
 */

export type OwnerAction = 'lock' | 'demote' | 'delete';

export class LastOwnerError extends Error {
  constructor(public readonly action: OwnerAction) {
    super(`Cannot ${action} the last active Owner`);
    this.name = 'LastOwnerError';
  }
}

/** Accepts the outer db or a transaction so the check runs inside the mutation's own tx. */
type Executor = Kysely<Database> | Transaction<Database>;

/**
 * The user ids that are *active* Owners: they hold the Owner role and are not
 * locked. A locked Owner can't act, so it doesn't count toward "an Owner still
 * exists" -- otherwise locking the one working Owner while a disabled Owner
 * lingers would leave the instance ownable-in-name-only, which is the brick
 * this guard exists to prevent.
 */
async function activeOwnerIds(db: Executor): Promise<Set<string>> {
  const rows = await db
    .selectFrom('role_assignments')
    .innerJoin('user', 'user.id', 'role_assignments.user_id')
    .select('user.id as id')
    .where('role_assignments.role_id', '=', BUILT_IN_ROLE_IDS.owner)
    .where('user.locked', '=', false)
    .execute();
  return new Set(rows.map((r) => r.id));
}

/**
 * Throws {@link LastOwnerError} when `action` on `userId` would leave zero
 * active Owners. Must run inside the mutation's transaction so the check and
 * the write are atomic -- a check-then-write across two statements would let
 * two concurrent demotes each see two Owners and both proceed, removing the
 * last one.
 *
 * Reasoning on pre-mutation state: for `lock` the target is still unlocked
 * (hence still active), for `demote`/`delete` the target's Owner row still
 * exists. If the target isn't currently an active Owner, the action can't
 * reduce the active-Owner count and is always allowed.
 */
export async function assertNotLastOwner(
  db: Executor,
  userId: string,
  action: OwnerAction,
): Promise<void> {
  const owners = await activeOwnerIds(db);
  if (!owners.has(userId)) return;
  if (owners.size <= 1) {
    throw new LastOwnerError(action);
  }
}
