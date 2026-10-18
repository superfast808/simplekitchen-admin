import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set");
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });

export async function runStartupMigrations() {
  const client = await pool.connect();
  try {
    // Initialise the session store in migrations. connect-pg-simple's
    // createTableIfMissing fallback reads table.sql from disk, which is not
    // present in the esbuild production bundle on a brand-new database.
    await client.query(`
      CREATE TABLE IF NOT EXISTS "session" (
        sid VARCHAR PRIMARY KEY,
        sess JSON NOT NULL,
        expire TIMESTAMP(6) NOT NULL
      )
    `);
    await client.query('CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" (expire)');

    // Fix manual orders that fell into the "gap" between the Thursday 07:00 cutoff and
    // the next Saturday — these orders are invisible because no week window covers them.
    // Snap them back to noon on the Saturday of their own week so they appear correctly.
    // DOW: 4=Thursday, 5=Friday (UTC). Formula: DATE_TRUNC('day', order_date) - (DOW+1) days + 12h
    await client.query(`
      UPDATE orders
      SET order_date = DATE_TRUNC('day', order_date)
                       - ((EXTRACT(DOW FROM order_date)::int + 1) * INTERVAL '1 day')
                       + INTERVAL '12 hours'
      WHERE is_manual = true
        AND (
          (EXTRACT(DOW FROM order_date) = 4 AND EXTRACT(HOUR FROM order_date) >= 7)
          OR EXTRACT(DOW FROM order_date) = 5
        )
    `);

    await client.query(`CREATE TABLE IF NOT EXISTS order_action_audit (id bigserial PRIMARY KEY, order_id integer NOT NULL, actor_id text NOT NULL, action text NOT NULL, details text NOT NULL, created_at timestamptz NOT NULL DEFAULT NOW())`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS customer_magic_links (
        token_hash text PRIMARY KEY, email text NOT NULL, expires_at timestamptz NOT NULL,
        consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    // Keep interest sign-ups separate from authentication links. A person can
    // register once, and failed SMTP delivery can be retried after 30 minutes.
    await client.query(`
      CREATE TABLE IF NOT EXISTS customer_portal_interest (
        email text PRIMARY KEY,
        ip_hash text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        last_attempt_at timestamptz NOT NULL DEFAULT now(),
        customer_sent_at timestamptz,
        owner_sent_at timestamptz
      )
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_customer_portal_interest_ip ON customer_portal_interest (ip_hash, created_at)`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS customer_portal_sessions (
        token_hash text PRIMARY KEY, email text NOT NULL, expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query("ALTER TABLE customer_magic_links ADD COLUMN IF NOT EXISTS test_recipient text");
    await client.query("ALTER TABLE customer_portal_sessions ADD COLUMN IF NOT EXISTS test_recipient text");
    await client.query(`CREATE TABLE IF NOT EXISTS customer_push_test_devices (
      endpoint text PRIMARY KEY, customer_email text NOT NULL, test_recipient text NOT NULL,
      registered_at timestamptz NOT NULL DEFAULT now()
    )`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS customer_portal_notifications (
        id bigserial PRIMARY KEY, email text NOT NULL, event_key text NOT NULL UNIQUE,
        delivered_to text, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await client.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_delivery_instructions text
    `);

    await client.query(`CREATE TABLE IF NOT EXISTS customer_portal_alerts (
      id bigserial PRIMARY KEY, email text NOT NULL, event_key text NOT NULL UNIQUE,
      title text NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT NOW()
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS customer_portal_alert_reads (
      alert_id bigint NOT NULL REFERENCES customer_portal_alerts(id) ON DELETE CASCADE,
      email text NOT NULL, read_at timestamptz NOT NULL DEFAULT NOW(),
      PRIMARY KEY(alert_id,email)
    )`);
    await client.query(`CREATE TABLE IF NOT EXISTS customer_push_subscriptions (
      endpoint text PRIMARY KEY, email text NOT NULL, p256dh text NOT NULL, auth text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT NOW(), last_success_at timestamptz
    )`);
    // Add portal_overridden column to orders if not exists
    await client.query(`
      ALTER TABLE orders ADD COLUMN IF NOT EXISTS portal_overridden boolean NOT NULL DEFAULT false
    `);

    // Create standard_ingredients table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS standard_ingredients (
        id serial PRIMARY KEY,
        name text NOT NULL UNIQUE,
        cost_per_g decimal(10,6) NOT NULL,
        unit text NOT NULL DEFAULT 'g'
      )
    `);

    // Seed from existing ingredients that have cost_per_g, but only if library is empty
    const { rows } = await client.query(`SELECT COUNT(*) FROM standard_ingredients`);
    if (parseInt(rows[0].count) === 0) {
      await client.query(`
        INSERT INTO standard_ingredients (name, cost_per_g, unit)
        SELECT DISTINCT ON (name) name, cost_per_g, unit
        FROM ingredients
        WHERE cost_per_g IS NOT NULL AND cost_per_g != '0'
        ORDER BY name, cost_per_g DESC
        ON CONFLICT (name) DO NOTHING
      `);
    }

    // Create subscribers table for manual subscriber management
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscribers (
        id SERIAL PRIMARY KEY,
        customer_name TEXT NOT NULL,
        customer_email TEXT NOT NULL,
        delivery_day TEXT NOT NULL DEFAULT 'sat',
        quantity INTEGER NOT NULL DEFAULT 1,
        payment_interval_weeks INTEGER NOT NULL DEFAULT 1,
        active BOOLEAN NOT NULL DEFAULT true,
        last_payment_sent_at TIMESTAMP,
        next_payment_due_at TIMESTAMP,
        notes TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Add delivery address + fee columns to subscribers
    await client.query(`
      ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS delivery_address TEXT
    `);
    await client.query(`
      ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS delivery_fee_pence INTEGER NOT NULL DEFAULT 0
    `);
    await client.query(`
      ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS included_oats INTEGER NOT NULL DEFAULT 0
    `);
    await client.query(`
      ALTER TABLE subscribers ADD COLUMN IF NOT EXISTS included_sweet_treats INTEGER NOT NULL DEFAULT 0
    `);
    // Propagate included add-ons to invites so the invite completion flow can enforce them
    await client.query(`
      ALTER TABLE subscription_invites ADD COLUMN IF NOT EXISTS included_oats INTEGER NOT NULL DEFAULT 0
    `);
    await client.query(`
      ALTER TABLE subscription_invites ADD COLUMN IF NOT EXISTS included_sweet_treats INTEGER NOT NULL DEFAULT 0
    `);

    // Add subscriber_id FK column to subscription_invites
    await client.query(`
      ALTER TABLE subscription_invites ADD COLUMN IF NOT EXISTS subscriber_id INTEGER
    `);


    // Run exactly once for historical rows. An old invite is unverified,
    // NOT evidence of SMTP acceptance, and must not be mass-resent on deploy.
    const trackingWasInstalled = await client.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'subscription_invites'
        AND column_name = 'invite_email_legacy'
    `);
    await client.query(`ALTER TABLE subscription_invites ADD COLUMN IF NOT EXISTS invite_email_sent_at TIMESTAMP`);
    await client.query(`ALTER TABLE subscription_invites ADD COLUMN IF NOT EXISTS invite_email_last_attempt_at TIMESTAMP`);
    await client.query(`ALTER TABLE subscription_invites ADD COLUMN IF NOT EXISTS invite_email_last_error TEXT`);
    await client.query(`ALTER TABLE subscription_invites ADD COLUMN IF NOT EXISTS invite_email_legacy BOOLEAN NOT NULL DEFAULT FALSE`);
    if (trackingWasInstalled.rowCount === 0) {
      await client.query(`
        UPDATE subscription_invites
        SET invite_email_legacy = TRUE
        WHERE invite_email_last_attempt_at IS NULL
      `);
    }

    // Staff MFA credentials are intentionally separate from the basic user
    // table so existing accounts remain intact throughout enrolment.
    await client.query(`
      CREATE TABLE IF NOT EXISTS staff_mfa_passkeys (
        credential_id TEXT PRIMARY KEY,
        user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        public_key BYTEA NOT NULL,
        sign_count BIGINT NOT NULL DEFAULT 0,
        transports JSONB NOT NULL DEFAULT '[]'::jsonb,
        name TEXT NOT NULL DEFAULT 'Passkey',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_used_at TIMESTAMPTZ
      )
    `);
    await client.query("CREATE INDEX IF NOT EXISTS idx_staff_passkeys_user ON staff_mfa_passkeys(user_id)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS staff_mfa_totp (
        user_id VARCHAR PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        secret_enc TEXT NOT NULL,
        last_used_step BIGINT NOT NULL DEFAULT -1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS staff_mfa_email (
        user_id VARCHAR PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        address TEXT NOT NULL,
        verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Durable, one-per-UK-Thursday staff reminder ledger. This survives
    // Docker restarts and stops multiple app instances sending duplicate mail.
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscription_staff_reminder_runs (
        reminder_date DATE PRIMARY KEY,
        last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        attempts INTEGER NOT NULL DEFAULT 1,
        sent_at TIMESTAMPTZ,
        recipient_emails TEXT NOT NULL,
        last_error TEXT
      )
    `);

    // Unique partial index: one invite per subscriber per week (NULL subscriber_id rows excluded)
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_invites_subscriber_week
      ON subscription_invites (subscriber_id, week_from)
      WHERE subscriber_id IS NOT NULL
    `);
  } finally {
    client.release();
  }
}
