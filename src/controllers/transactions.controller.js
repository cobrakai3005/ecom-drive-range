import { pool } from "../config/db.js";
import { logAudit } from "../lib/auditLog.js";

// Get all transactions (Admin, Staff only) – with pagination and search
export const getAllTransactions = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;

  const search = req.query.search || "";
  const { order_id, transaction_type, status } = req.query;

  try {
    let whereClause = "1=1";
    const queryParams = [];

    if (search) {
      whereClause += ` AND (
        t.gateway_reference_id LIKE ? OR 
        t.currency_code LIKE ? OR
        o.id LIKE ?
      )`;
      const searchPattern = `%${search}%`;
      queryParams.push(searchPattern, searchPattern, searchPattern);
    }

    if (order_id) {
      whereClause += " AND t.order_id = ?";
      queryParams.push(order_id);
    }

    if (transaction_type) {
      whereClause += " AND t.transaction_type = ?";
      queryParams.push(transaction_type);
    }

    if (status) {
      whereClause += " AND t.status = ?";
      queryParams.push(status);
    }

    // Count total
    const countQuery = `
      SELECT COUNT(*) as total
      FROM transactions t
      JOIN orders o ON t.order_id = o.id
      WHERE ${whereClause}
    `;
    const [countResult] = await pool.query(countQuery, queryParams);
    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit);

    // Data query – removed payment_methods join, added o.payment_method
    const dataQuery = `
      SELECT t.*, 
             o.payment_method,   -- from orders table
             o.user_id, 
             o.order_status,
             u.full_name as  customer_name
      FROM transactions t
      JOIN orders o ON t.order_id = o.id
      JOIN users u ON o.user_id = u.id

      WHERE ${whereClause}
      ORDER BY t.transaction_date DESC
      LIMIT ? OFFSET ?
    `;
    const dataParams = [...queryParams, limit, offset];
    const [transactions] = await pool.query(dataQuery, dataParams);

    res.json({
      success: true,
      data: transactions,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Create a new transaction (called by payment gateway webhook or admin)
export const createTransaction = async (req, res) => {
  const {
    order_id,
    payment_method, // changed from payment_method_id – now a string, e.g., 'card'
    transaction_type,
    amount,
    currency_code = "IND",
    gateway_reference_id,
    status = "pending",
    error_message = null,
  } = req.body;

  if (!order_id || !transaction_type || !amount || !payment_method) {
    return res.status(400).json({
      success: false,
      message:
        "Missing required fields (order_id, payment_method, transaction_type, amount)",
    });
  }

  try {
    // Optional: verify that the order exists and the payment method matches the order's payment_method?
    // (You can skip this check for simplicity)
    const [orderCheck] = await pool.query(
      "SELECT id FROM orders WHERE id = ?",
      [order_id],
    );
    if (orderCheck.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Order not found" });
    }

    const [result] = await pool.query(
      `INSERT INTO transactions 
       (order_id, payment_method, transaction_type, amount, currency_code, 
        gateway_reference_id, status, error_message, transaction_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        order_id,
        payment_method, // store directly, not an ID
        transaction_type,
        amount,
        currency_code,
        gateway_reference_id,
        status,
        error_message,
      ],
    );

    const [newTx] = await pool.query(
      "SELECT * FROM transactions WHERE id = ?",
      [result.insertId],
    );
    await logAudit({
      userId: req.user.id,
      action: "CREATE",
      tableName: "transactions",
      recordId: newTx[0].id,
      oldData: null,
      newData: newTx[0],
      req,
    });
    res
      .status(201)
      .json({ success: true, data: { transaction_id: result.insertId } });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ success: false, message: "Failed to create transaction" });
  }
};

// Update transaction status (e.g., from pending to success/failed via webhook)
export const updateTransactionStatus = async (req, res) => {
  const { id } = req.params;
  const { status, gateway_reference_id, error_message } = req.body;

  if (!status) {
    return res.status(400).json({ success: false, message: "Status required" });
  }
  const [existing] = await pool.query(
    `SELECT * FROM transactions WHERE id = ? LIMIT 1`,
    [id],
  );
  if (existing.length === 0) {
    return res
      .status(404)
      .json({ success: false, message: "No Transaction found" });
  }
  try {
    await pool.query(
      `UPDATE transactions 
       SET status = ?, 
           gateway_reference_id = COALESCE(?, gateway_reference_id),
           error_message = ?
       WHERE id = ?`,
      [status, gateway_reference_id, error_message, id],
    );

    const [newTxRow] = await pool.query(
      `SELECT * FROM transactions WHERE id = ? LIMIT 1`,
      [id],
    );
    await logAudit({
      userId: req.user.id,
      action: `UPDATE_TRANSACTION_${newTxRow[0].transaction_type}`,
      tableName: "transactions",
      recordId: id,
      oldData: existing[0],
      newData: newTxRow[0],
      req,
    });
    res.json({ success: true, message: "Transaction updated" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Get transaction by ID (Admin, Staff, or Customer if it belongs to their order)
export const getTransactionById = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    let query = `
      SELECT t.*, 
             o.payment_method, 
             o.user_id as order_user_id,
             o.order_status
      FROM transactions t
      JOIN orders o ON t.order_id = o.id
      WHERE t.id = ?
    `;
    const params = [id];

    if (userRole === "Customer") {
      query += " AND o.user_id = ?";
      params.push(userId);
    }

    const [transactions] = await pool.query(query, params);
    if (transactions.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Transaction not found" });
    }
    // Remove sensitive data (if any)
    delete transactions[0].order_user_id;
    res.json({ success: true, data: transactions[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getTransactionDashboardStats = async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        COUNT(*) AS total_transactions,

        SUM(CASE
          WHEN status = 'pending' THEN 1
          ELSE 0
        END) AS pending_transactions,

        SUM(
            CASE
                WHEN DATE(transaction_date) = CURDATE()
                  AND status = 'success'
                  AND transaction_type IN ('payment', 'capture')
                THEN amount
                ELSE 0
              END
          ) AS amount_received_today,

        SUM(CASE
          WHEN status = 'success' THEN 1
          ELSE 0
        END) AS successful_transactions,

        SUM(CASE
          WHEN status = 'failed' THEN 1
          ELSE 0
        END) AS failed_transactions,

        SUM(CASE
          WHEN transaction_type = 'payment' THEN 1
          ELSE 0
        END) AS payment_transactions,

        SUM(CASE
          WHEN transaction_type = 'refund' THEN 1
          ELSE 0
        END) AS refund_transactions,

        SUM(CASE
          WHEN DATE(transaction_date) = CURDATE() THEN 1
          ELSE 0
        END) AS new_transactions_today,

        SUM(CASE
          WHEN DATE(transaction_date) = CURDATE()
            AND status = 'success'
            AND transaction_type IN ('payment', 'capture')
          THEN amount
          ELSE 0
        END) AS today_successful_amount,

        SUM(CASE
          WHEN DATE(transaction_date) = CURDATE()
            AND status = 'success'
            AND transaction_type = 'refund'
          THEN amount
          ELSE 0
        END) AS today_refund_amount,

        SUM(CASE
          WHEN status = 'success'
            AND transaction_type IN ('payment', 'capture')
          THEN amount
          ELSE 0
        END) AS total_successful_amount,

        SUM(CASE
          WHEN status = 'success'
            AND transaction_type = 'refund'
          THEN amount
          ELSE 0
        END) AS total_refund_amount

      FROM transactions
    `);

    const stats = rows[0];

    const todaySuccessfulAmount = Number(stats.today_successful_amount) || 0;

    const todayRefundAmount = Number(stats.today_refund_amount) || 0;

    const totalSuccessfulAmount = Number(stats.total_successful_amount) || 0;

    const totalRefundAmount = Number(stats.total_refund_amount) || 0;

    return res.status(200).json({
      success: true,
      data: {
        total_transactions: Number(stats.total_transactions) || 0,
        pending_transactions: Number(stats.pending_transactions) || 0,
        successful_transactions: Number(stats.successful_transactions) || 0,
        failed_transactions: Number(stats.failed_transactions) || 0,

        payment_transactions: Number(stats.payment_transactions) || 0,
        refund_transactions: Number(stats.refund_transactions) || 0,

        new_transactions_today: Number(stats.new_transactions_today) || 0,

        today_successful_amount: todaySuccessfulAmount,
        today_refund_amount: todayRefundAmount,
        today_net_amount: todaySuccessfulAmount - todayRefundAmount,

        total_successful_amount: totalSuccessfulAmount,
        total_refund_amount: totalRefundAmount,
        total_net_amount: totalSuccessfulAmount - totalRefundAmount,
      },
    });
  } catch (error) {
    console.error("Transaction dashboard stats error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch transaction dashboard statistics",
    });
  }
};
