import { pool } from "../config/db.js";

export const getAuditLogs = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  const offset = (page - 1) * limit;
  const { table_name, action, user_id, from_date, to_date } = req.query;

  let whereClause = "1=1";
  const params = [];
  if (table_name) {
    whereClause += ` AND table_name = ?`;
    params.push(table_name);
  }
  if (action) {
    whereClause += ` AND action = ?`;
    params.push(action);
  }
  if (user_id) {
    whereClause += ` AND user_id = ?`;
    params.push(user_id);
  }
  if (from_date) {
    whereClause += ` AND created_at >= ?`;
    params.push(from_date);
  }
  if (to_date) {
    whereClause += ` AND created_at <= ?`;
    params.push(to_date);
  }

  const [countResult] = await pool.query(`SELECT COUNT(*) as total FROM audit_log WHERE ${whereClause}`, params);
  const totalItems = countResult[0].total;
  const totalPages = Math.ceil(totalItems / limit);

  const [logs] = await pool.query(
    `SELECT al.*, u.full_name as user_name
     FROM audit_log al
     LEFT JOIN users u ON al.user_id = u.id
     WHERE ${whereClause}
     ORDER BY al.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  res.json({ success: true, data: logs, pagination: { page, limit, totalItems, totalPages } });
};

export const getAuditLogByRecord = async (req, res) => {
  const { table_name, record_id } = req.params;
  try {
    const [logs] = await pool.query(
      `SELECT al.*, u.full_name as user_name
       FROM audit_log al
       LEFT JOIN users u ON al.user_id = u.id
       WHERE table_name = ? AND record_id = ?
       ORDER BY created_at DESC`,
      [table_name, record_id]
    );
    res.json({ success: true, data: logs });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};