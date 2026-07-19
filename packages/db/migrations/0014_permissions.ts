import type { Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';
import { BUILT_IN_ROLE_IDS } from './0009_rbac';

/**
 * The catalog of concrete (non-wildcard) permissions the application
 * actually checks -- documentation, write-time validation for grants, and
 * the data behind a future permissions-picker UI. No surrogate id: grants
 * in role_permissions store resource/action as plain text rather than an
 * FK into this table, since a grant like `project:*` is a pattern, not a
 * catalog entry.
 */
const PERMISSION_CATALOG: Array<{ resource: string; action: string; description: string }> = [
  { resource: 'org', action: 'view', description: 'View the organization' },
  { resource: 'org', action: 'update', description: 'Rename or update the organization' },

  { resource: 'workspace', action: 'view', description: 'View a workspace' },
  { resource: 'workspace', action: 'create', description: 'Create a workspace' },
  { resource: 'workspace', action: 'update', description: 'Rename or update a workspace' },
  { resource: 'workspace', action: 'delete', description: 'Delete a workspace' },

  { resource: 'project', action: 'view', description: 'View a project' },
  { resource: 'project', action: 'create', description: 'Create a project' },
  { resource: 'project', action: 'update', description: 'Update a project' },
  { resource: 'project', action: 'delete', description: 'Delete a project' },

  { resource: 'namespace', action: 'view', description: 'View a namespace' },
  { resource: 'namespace', action: 'create', description: 'Create a namespace' },
  { resource: 'namespace', action: 'update', description: 'Update a namespace' },
  { resource: 'namespace', action: 'delete', description: 'Delete a namespace' },

  { resource: 'key', action: 'view', description: 'View a key' },
  { resource: 'key', action: 'create', description: 'Create a key' },
  { resource: 'key', action: 'update', description: 'Update a key' },
  { resource: 'key', action: 'delete', description: 'Delete a key' },

  { resource: 'locale', action: 'view', description: 'View a locale' },
  { resource: 'locale', action: 'create', description: 'Create a locale' },
  { resource: 'locale', action: 'update', description: 'Update a locale' },
  { resource: 'locale', action: 'delete', description: 'Delete a locale' },

  { resource: 'translation', action: 'view', description: 'View a translation' },
  { resource: 'translation', action: 'save', description: 'Save a translation' },
  { resource: 'translation', action: 'claim', description: 'Claim a translation for review' },
  { resource: 'translation', action: 'approve', description: 'Approve a translation' },
  {
    resource: 'translation',
    action: 'send_back',
    description: 'Send a translation back for changes',
  },

  { resource: 'comment', action: 'view', description: 'View comments on a key or translation' },
  { resource: 'comment', action: 'create', description: 'Post a comment on a key or translation' },

  { resource: 'user', action: 'view', description: 'View a user' },
  { resource: 'user', action: 'update', description: 'Update a user (e.g. lock/unlock)' },
  { resource: 'user', action: 'delete', description: 'Delete a user' },

  { resource: 'role', action: 'view', description: 'View a role' },
  { resource: 'role', action: 'create', description: 'Create a custom role' },
  { resource: 'role', action: 'update', description: 'Update a role' },
  { resource: 'role', action: 'delete', description: 'Delete a role' },

  { resource: 'role_assignment', action: 'view', description: "View a user's role assignments" },
  { resource: 'role_assignment', action: 'create', description: 'Assign a role to a user' },
  { resource: 'role_assignment', action: 'revoke', description: "Revoke a user's role assignment" },

  { resource: 'invite', action: 'view', description: 'View a pending invite' },
  { resource: 'invite', action: 'create', description: 'Create an invite link' },
  { resource: 'invite', action: 'revoke', description: 'Revoke an invite link' },

  { resource: 'settings', action: 'view', description: 'View project settings' },
  { resource: 'settings', action: 'update', description: 'Update project settings' },
];

/**
 * The starter role -> permission matrix (M3 plan doc, "Starter role ->
 * permission matrix"). Each pattern is `resource:action`, where either
 * segment may be `*`. Owner's `*:*` grant is seeded separately above since
 * it's the only role whose *resource* is also a wildcard.
 */
const STARTER_GRANTS: Record<string, string[]> = {
  admin: [
    'project:*',
    'namespace:*',
    'key:*',
    'locale:*',
    'translation:*',
    'comment:*',
    'settings:*',
    'user:*',
    'invite:*',
    'role_assignment:*',
    'workspace:view',
  ],
  developer: [
    'project:view',
    'namespace:*',
    'key:*',
    'locale:view',
    'translation:view',
    'translation:save',
    'comment:view',
    'comment:create',
  ],
  translator: [
    'project:view',
    'key:view',
    'locale:view',
    'translation:view',
    'translation:save',
    'comment:view',
    'comment:create',
  ],
  reviewer: [
    'project:view',
    'key:view',
    'locale:view',
    'translation:view',
    'translation:save',
    'comment:view',
    'comment:create',
    'translation:claim',
    'translation:approve',
    'translation:send_back',
  ],
  viewer: ['project:view', 'key:view', 'locale:view', 'translation:view', 'comment:view'],
};

export const migration0014Permissions: Migration = {
  async up(db: Kysely<any>): Promise<void> {
    await db.schema
      .createTable('permissions')
      .addColumn('resource', 'text', (col) => col.notNull())
      .addColumn('action', 'text', (col) => col.notNull())
      .addColumn('description', 'text', (col) => col.notNull())
      .addPrimaryKeyConstraint('permissions_pkey', ['resource', 'action'])
      .execute();

    await db.insertInto('permissions').values(PERMISSION_CATALOG).execute();

    await db.insertInto('roles').values({ id: BUILT_IN_ROLE_IDS.owner, name: 'Owner' }).execute();

    await db.schema
      .createTable('role_permissions')
      .addColumn('id', 'uuid', (col) => col.primaryKey())
      .addColumn('role_id', 'uuid', (col) =>
        col.notNull().references('roles.id').onDelete('cascade'),
      )
      .addColumn('resource', 'text', (col) => col.notNull())
      .addColumn('action', 'text', (col) => col.notNull())
      .addUniqueConstraint('role_permissions_role_id_resource_action_unique', [
        'role_id',
        'resource',
        'action',
      ])
      .execute();

    await db
      .insertInto('role_permissions')
      .values({
        id: crypto.randomUUID(),
        role_id: BUILT_IN_ROLE_IDS.owner,
        resource: '*',
        action: '*',
      })
      .execute();

    for (const [roleKey, patterns] of Object.entries(STARTER_GRANTS)) {
      const roleId = BUILT_IN_ROLE_IDS[roleKey as keyof typeof BUILT_IN_ROLE_IDS];
      await db
        .insertInto('role_permissions')
        .values(
          patterns.map((pattern) => {
            const [resource, action] = pattern.split(':');
            return { id: crypto.randomUUID(), role_id: roleId, resource, action };
          }),
        )
        .execute();
    }
  },

  async down(db: Kysely<any>): Promise<void> {
    await db.schema.dropTable('role_permissions').execute();
    await db.deleteFrom('roles').where('id', '=', BUILT_IN_ROLE_IDS.owner).execute();
    await db.schema.dropTable('permissions').execute();
  },
};
