import type { Migration } from 'kysely/migration';
import { migration0001Organizations } from './0001_organizations';
import { migration0002Workspaces } from './0002_workspaces';
import { migration0003Projects } from './0003_projects';
import { migration0004Locales } from './0004_locales';
import { migration0005Namespaces } from './0005_namespaces';
import { migration0006Keys } from './0006_keys';
import { migration0007Translations } from './0007_translations';

export const migrations: Record<string, Migration> = {
  '0001_organizations': migration0001Organizations,
  '0002_workspaces': migration0002Workspaces,
  '0003_projects': migration0003Projects,
  '0004_locales': migration0004Locales,
  '0005_namespaces': migration0005Namespaces,
  '0006_keys': migration0006Keys,
  '0007_translations': migration0007Translations,
};
