// SERVER-ONLY. Idempotent seeding of the fictional demo identities (never real people or data).
import { DEMO_USERS } from "./demo-users";
import type { Database } from "./db";

export async function ensureDemoUsers(db: Database): Promise<number> {
  return db.withAdmin(async (tx) => {
    let added = 0;
    for (const u of DEMO_USERS) {
      const r = await tx.query(
        `INSERT INTO users (id, email, name, role, station, station_code, clearance) VALUES ($1,$2,$3,$4::user_role,$5,$6,$7) ON CONFLICT (id) DO NOTHING RETURNING id`,
        [u.id, u.email, u.name, u.role, u.station, u.stationCode ?? null, u.clearance],
      );
      added += r.rowCount;
    }
    return added;
  });
}
