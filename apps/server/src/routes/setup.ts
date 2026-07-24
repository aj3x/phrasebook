import { BUILT_IN_ROLE_IDS, type Database, INSTANCE_SETUP_ID } from '@phrasebook/db';
import { Hono } from 'hono';
import type { Kysely } from 'kysely';
import type { Auth } from '../auth';
import { requireUnlocked } from '../middleware/permission';
import type { Env } from '../types';

/**
 * First-run onboarding backend (M3 Phase B). A freshly hosted instance has
 * no org, no owner, no way in -- these routes are the seed-free bootstrap the
 * setup wizard drives (plan/03-milestone-3-onboarding.md).
 *
 * `GET /v1/setup/status` is the one public, always-available probe: the editor
 * calls it on load to decide wizard-vs-login. It returns *only* a boolean --
 * never the org name or owner email -- so an unauthenticated caller learns
 * whether setup is needed and nothing else (Security spotlight, §"status is
 * public").
 */

// better-auth's default emailAndPassword.minPasswordLength. Pre-checked here
// so a weak password gets a clean 400 from us rather than a thrown APIError
// deeper in; better-auth remains the real gate.
const MIN_PASSWORD_LENGTH = 8;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

interface SetupBody {
  ownerEmail: string;
  password: string;
  ownerName: string;
  orgName: string;
}

function parseSetupBody(body: Record<string, unknown>): SetupBody | { error: string } {
  const { ownerEmail, password, ownerName, orgName } = body;

  if (typeof ownerEmail !== 'string' || !EMAIL_RE.test(ownerEmail)) {
    return { error: 'A valid ownerEmail is required' };
  }
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return { error: `password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  if (typeof orgName !== 'string' || orgName.trim() === '') {
    return { error: 'orgName is required' };
  }

  return {
    ownerEmail,
    password,
    orgName: orgName.trim(),
    // ownerName is optional; better-auth requires a name, so default it.
    ownerName:
      typeof ownerName === 'string' && ownerName.trim() !== '' ? ownerName.trim() : 'Owner',
  };
}

export function createSetupRoutes(auth: Auth, db: Kysely<Database>) {
  const app = new Hono<Env>();

  app.get('/setup/status', async (c) => {
    const org = await db.selectFrom('organizations').select('id').limit(1).executeTakeFirst();
    return c.json({ needsSetup: org === undefined });
  });

  /**
   * The load-bearing bootstrap (M3 Phase B step 10). Creates the first Owner
   * and organization atomically, and signs the owner in. Unauthenticated by
   * necessity -- there is nobody to authenticate as yet -- but inert by design
   * once setup is done:
   *
   *   - A fast state check refuses with **409** (not 403: the request is
   *     well-formed, it just no longer applies) the moment an org exists.
   *   - Race safety is enforced at the DB, not the app: the owner assignment,
   *     org, workspace, and the fixed-PK `instance_setup` row commit in one
   *     transaction, so two racing calls both passing the state check still
   *     collide on the singleton's primary key -- the loser rolls back whole
   *     and gets a 409, and only one Owner ever exists (DoD #6).
   *
   * The better-auth user is created *before* the transaction (its adapter
   * writes on its own connection, so it can't join our tx). The meaningful
   * atomic unit -- org + workspace + owner-assignment + singleton -- is what
   * commits together; a race loser leaves only an orphaned, role-less user,
   * which can do nothing and never becomes a second Owner.
   */
  app.post('/setup', async (c) => {
    const raw = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const parsed = parseSetupBody(raw);
    if ('error' in parsed) {
      return c.json({ error: parsed.error }, 400);
    }

    // Fast path: already set up. Not the race guard (that's the singleton
    // below) -- just an immediate, cheap 409 for the common repeat call.
    const existingOrg = await db.selectFrom('organizations').select('id').executeTakeFirst();
    if (existingOrg) {
      return c.json({ error: 'This instance has already been set up' }, 409);
    }

    // Real sign-up path (password hashing, session creation) via better-auth.
    // asResponse gives us the Set-Cookie header to forward, so the owner is
    // signed in on the same request that created them.
    let signUpRes: Response;
    try {
      signUpRes = await auth.api.signUpEmail({
        body: { name: parsed.ownerName, email: parsed.ownerEmail, password: parsed.password },
        asResponse: true,
      });
    } catch {
      return c.json({ error: 'Could not create the owner account' }, 400);
    }
    if (!signUpRes.ok) {
      return c.json({ error: 'Could not create the owner account' }, 400);
    }
    const signUpBody = (await signUpRes.json()) as { user: { id: string } };
    const userId = signUpBody.user.id;

    const orgId = crypto.randomUUID();
    const workspaceId = crypto.randomUUID();
    try {
      await db.transaction().execute(async (trx) => {
        // Order is FK-driven: the org must exist before instance_setup and
        // workspace reference it. Atomicity, not ordering, is what makes the
        // singleton the guard -- if instance_setup's fixed PK collides with a
        // racing winner, the whole transaction (org included) rolls back.
        await trx.insertInto('organizations').values({ id: orgId, name: parsed.orgName }).execute();
        await trx
          .insertInto('workspaces')
          .values({ id: workspaceId, org_id: orgId, name: parsed.orgName })
          .execute();
        await trx
          .insertInto('instance_setup')
          .values({ id: INSTANCE_SETUP_ID, owner_user_id: userId, org_id: orgId })
          .execute();
        await trx
          .insertInto('role_assignments')
          .values({ id: crypto.randomUUID(), user_id: userId, role_id: BUILT_IN_ROLE_IDS.owner })
          .execute();
      });
    } catch (err) {
      // Lost the singleton race (or otherwise already set up): re-check and
      // return 409 if setup now exists, else surface the real failure.
      const nowSetUp = await db.selectFrom('instance_setup').select('id').executeTakeFirst();
      if (nowSetUp) {
        return c.json({ error: 'This instance has already been set up' }, 409);
      }
      throw err;
    }

    const setCookie = signUpRes.headers.get('set-cookie');
    if (setCookie) {
      c.header('set-cookie', setCookie);
    }
    return c.json({ userId, orgId, workspaceId }, 201);
  });

  /**
   * Optional onboarding questionnaire capture (M3 Phase B step 12). Stores the
   * wizard's survey answers as a free-form JSON blob scoped to the submitting
   * user. Skippable by construction: completion never depends on this, and
   * nothing in M3 reads it back -- it's captured for future defaults/tour work.
   * Requires only a valid (unlocked) session, since the owner submits their own
   * answers; no dedicated permission gates a user's own survey.
   */
  app.post('/setup/survey', async (c) => {
    const actor = await requireUnlocked(c, db);
    if (actor instanceof Response) return actor;

    const payload = (await c.req.json().catch(() => undefined)) as unknown;
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return c.json({ error: 'A JSON object body is required' }, 400);
    }

    await db
      .insertInto('onboarding_responses')
      .values({
        id: crypto.randomUUID(),
        user_id: actor.userId,
        payload: JSON.stringify(payload),
      })
      .execute();

    return c.json({ ok: true }, 201);
  });

  return app;
}
