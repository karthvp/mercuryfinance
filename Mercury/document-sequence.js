// Imported legacy documents can have explicit ids without advancing SERIAL.
// Serialize the repair against inserts and never move an already-ahead sequence backward.
async function repairDocumentSequence(db) {
  await db.query('BEGIN');
  try {
    await db.query('LOCK TABLE mercury_data IN SHARE ROW EXCLUSIVE MODE');
    const { rows } = await db.query("SELECT pg_get_serial_sequence('mercury_data', 'id') AS sequence");
    if (!rows[0].sequence) {
      // Some legacy schemas have DEFAULT 1 instead of a sequence-backed default.
      // CREATE TABLE IF NOT EXISTS cannot correct that existing column metadata.
      await db.query('CREATE SEQUENCE IF NOT EXISTS mercury_data_id_seq');
      await db.query('ALTER SEQUENCE mercury_data_id_seq OWNED BY mercury_data.id');
      await db.query("ALTER TABLE mercury_data ALTER COLUMN id SET DEFAULT nextval('mercury_data_id_seq'::regclass)");
    }
    await db.query(`SELECT setval(
      pg_get_serial_sequence('mercury_data', 'id'),
      GREATEST(
        COALESCE((SELECT MAX(id) FROM mercury_data), 1),
        COALESCE(pg_sequence_last_value(pg_get_serial_sequence('mercury_data', 'id')::regclass), 1)
      ),
      true
    )`);
    await db.query('COMMIT');
  } catch (error) {
    await db.query('ROLLBACK');
    throw error;
  }
}
module.exports = repairDocumentSequence;
