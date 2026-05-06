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
  } finally {
    client.release();
  }
}
