/**
 * Hand-authored to match the migrations in `migrations/`, then verified by
 * running those migrations against a real Postgres-wire-compatible engine
 * (pg-mem) in `test/`. Regenerate with `kysely-codegen` against a live
 * Postgres (`docker compose up` + `pnpm db:migrate`) when convenient —
 * this file should then diff clean.
 */
import type { ColumnType, Generated } from 'kysely';

type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null | undefined>;

export interface OrganizationsTable {
  id: string;
  name: string;
}

export interface WorkspacesTable {
  id: string;
  org_id: string;
  name: string;
}

export interface ProjectsTable {
  id: string;
  workspace_id: string;
  name: string;
  source_locale: string;
  /** Added by migrations/0011_project_auto_approve.ts. */
  auto_approve: Generated<boolean>;
}

export interface LocalesTable {
  id: string;
  project_id: string;
  code: string;
}

export type NamespaceAuthority = 'code' | 'platform';

export interface NamespacesTable {
  id: string;
  project_id: string;
  name: string;
  authority: NamespaceAuthority;
}

export interface KeysTable {
  id: string;
  namespace_id: string;
  name: string;
  source_text: string;
  source_hash: string;
}

export interface TranslationsTable {
  id: string;
  key_id: string;
  locale_id: string;
  target_text: string;
  status: string;
  updated_at: Generated<Date>;
  version: Generated<number>;
  /** Added by migrations/0012_translation_last_editor.ts. */
  last_editor_id: Nullable<string>;
}

/**
 * These four tables are better-auth's, not our domain model -- column
 * naming (camelCase) intentionally matches better-auth's own convention
 * rather than our snake_case elsewhere. See migrations/0008_better_auth.ts.
 */
export interface UserTable {
  id: string;
  name: string;
  email: string;
  emailVerified: Generated<boolean>;
  image: Nullable<string>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
  /** Added by migrations/0010_user_locked.ts -- ours, not better-auth's. */
  locked: Generated<boolean>;
}

export interface SessionTable {
  id: string;
  expiresAt: Date;
  token: string;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
  ipAddress: Nullable<string>;
  userAgent: Nullable<string>;
  userId: string;
}

export interface AccountTable {
  id: string;
  accountId: string;
  providerId: string;
  userId: string;
  accessToken: Nullable<string>;
  refreshToken: Nullable<string>;
  idToken: Nullable<string>;
  accessTokenExpiresAt: Nullable<Date>;
  refreshTokenExpiresAt: Nullable<Date>;
  scope: Nullable<string>;
  password: Nullable<string>;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface VerificationTable {
  id: string;
  identifier: string;
  value: string;
  expiresAt: Date;
  createdAt: Generated<Date>;
  updatedAt: Generated<Date>;
}

export interface RolesTable {
  id: string;
  name: string;
  is_custom: Generated<boolean>;
}

export interface RoleAssignmentsTable {
  id: string;
  user_id: string;
  role_id: string;
  project_id: Nullable<string>;
  locale_code: Nullable<string>;
}

export interface Database {
  organizations: OrganizationsTable;
  workspaces: WorkspacesTable;
  projects: ProjectsTable;
  locales: LocalesTable;
  namespaces: NamespacesTable;
  keys: KeysTable;
  translations: TranslationsTable;
  user: UserTable;
  session: SessionTable;
  account: AccountTable;
  verification: VerificationTable;
  roles: RolesTable;
  role_assignments: RoleAssignmentsTable;
}
