import { pool } from "../config/db.js";

// GET /api/audit-logs?page=1&limit=15&table_name=users&record_id=5&user_id=2&action=UPDATE
export const getAuditLogs = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 15;
    const offset = (page - 1) * limit;

    const { table_name, record_id, user_id, action, search } = req.query;

    const whereConditions = [];
    const params = [];

    // Build WHERE clause
    if (table_name) {
      // Use 'LIKE ?' with wildcards if you want partial match, or '= ?' for exact.
      // I'll use 'LIKE ?' with wildcards to be consistent with search.
      whereConditions.push("al.table_name LIKE ?");
      params.push(`%${table_name}%`);
    }
    if (record_id) {
      whereConditions.push("al.record_id = ?");
      params.push(String(record_id));
    }
    if (user_id) {
      whereConditions.push("al.user_id = ?");
      params.push(user_id);
    }
    if (action) {
      // Exact match on action
      whereConditions.push("al.action = ?");
      params.push(action);
    }
    if (search) {
      // Global search across multiple columns (partial match)
      whereConditions.push(
        "(al.table_name LIKE ? OR al.record_id LIKE ? OR al.user_id LIKE ? OR al.action LIKE ?)",
      );
      const like = `%${search}%`;
      params.push(like, like, like, like);
    }

    const whereClause =
      whereConditions.length > 0
        ? `WHERE ${whereConditions.join(" AND ")}`
        : "";

    const countQuery = `
      SELECT COUNT(*) as total
      FROM audit_log al
      ${whereClause}
    `;
    const [countResult] = await pool.query(countQuery, params);
    const total = countResult[0].total;

    const dataQuery = `
      SELECT al.*,
             u.full_name as user_name,
             u.email,
             u.phone,
             u.role,
             u.profile_image
      FROM audit_log al
      LEFT JOIN users u ON al.user_id = u.id
      ${whereClause}
      ORDER BY al.created_at DESC
      LIMIT ? OFFSET ?
    `;
    const dataParams = [...params, limit, offset];
    const [rows] = await pool.query(dataQuery, dataParams);
 
    res.json({
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error in getAuditLogs:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// auditLogController.js
export const getDistinctActions = async (req, res) => {
  try {
    const [rows] = await pool.query(
      "SELECT DISTINCT action FROM audit_log ORDER BY action",
    );
    res.json({ success: true, data: rows.map((r) => r.action) });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// GET /api/audit-logs/:table_name/:record_id
export const getAuditLogByRecord = async (req, res) => {
  const { table_name, record_id } = req.params;
  try {
    const [logs] = await pool.query(
      `SELECT al.*,
              u.full_name as user_name,
              u.email,
              u.phone,
              u.role,
              u.profile_image
       FROM audit_log al
       LEFT JOIN users u ON al.user_id = u.id
       WHERE al.table_name = ? AND al.record_id = ?
       ORDER BY al.created_at DESC`,
      [table_name, record_id],
    );
    res.json({ success: true, data: logs });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
