/**
 * Hand-authored to match the migrations in `migrations/`, then verified by
 * running those migrations against a real Postgres-wire-compatible engine
 * (pg-mem) in `test/`. Regenerate with `kysely-codegen` against a live
 * Postgres (`docker compose up` + `pnpm db:migrate`) when convenient —
 * this file should then diff clean.
 */
import type { Generated } from 'kysely';

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
}

export interface Database {
  organizations: OrganizationsTable;
  workspaces: WorkspacesTable;
  projects: ProjectsTable;
  locales: LocalesTable;
  namespaces: NamespacesTable;
  keys: KeysTable;
  translations: TranslationsTable;
}
