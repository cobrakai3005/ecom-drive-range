import { pool } from "../config/db.js";

export const logAudit = async ({
  userId,
  action,
  tableName,
  recordId,
  oldData,
  newData,
  req,
}) => {
  const sourceIp = req?.ip || req?.connection?.remoteAddress || null;
  await pool.query(
    `INSERT INTO audit_log 
         (user_id, action, table_name, record_id, old_data, new_data, source_ip)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      action,
      tableName,
      recordId,
      JSON.stringify(oldData),
      JSON.stringify(newData),
      sourceIp,
    ],
  );
};
