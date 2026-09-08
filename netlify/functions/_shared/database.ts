import { getDatabase } from "@netlify/database";

export type QueryResult<Row> = { rows: Row[]; rowCount: number | null };
export type DatabaseClient = {
  query: <Row = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<QueryResult<Row>>;
  release: () => void;
};

export async function withSession<Row>(userId: string, tenantId: string | null, operation: (client: DatabaseClient) => Promise<Row>): Promise<Row> {
  const database = getDatabase();
  const client = await database.pool.connect() as unknown as DatabaseClient;

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    if (tenantId) await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

