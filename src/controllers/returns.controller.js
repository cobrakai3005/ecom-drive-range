import { pool } from "../config/db.js";

// Helper to update order refund status if needed
const updateOrderRefundStatus = async (connection, orderId) => {
  const [returns] = await connection.query(
    `SELECT SUM(refund_amount) as total_refund FROM returns WHERE order_id = ? AND return_status = 'refund_issued'`,
    [orderId],
  );
  const [order] = await connection.query(
    `SELECT total_amount FROM orders WHERE id = ?`,
    [orderId],
  );
  if (returns[0].total_refund >= order[0].total_amount) {
    await connection.query(
      `UPDATE orders SET payment_status = 'refunded' WHERE id = ?`,
      [orderId],
    );
  } else if (returns[0].total_refund > 0) {
    await connection.query(
      `UPDATE orders SET payment_status = 'partial_refund' WHERE id = ?`,
      [orderId],
    );
  }
};

// Customer: request a return
export const requestReturn = async (req, res) => {
  const { order_id, return_reason, items } = req.body; // items: [{ order_item_id, quantity_returned }]
  const userId = req.user.id;

  if (!order_id || !return_reason || !items || !items.length) {
    return res
      .status(400)
      .json({ success: false, message: "Missing required fields" });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    // Verify order belongs to user and is delivered
    const [order] = await connection.query(
      `SELECT id, total_amount FROM orders WHERE id = ? AND user_id = ? AND order_status = 'delivered'`,
      [order_id, userId],
    );
    if (!order.length) {
      await connection.rollback();
      return res
        .status(403)
        .json({ success: false, message: "Order not found or not delivered" });
    }

    // Calculate refund amount based on item unit prices from order_items snapshot
    let refundAmount = 0;
    for (const item of items) {
      const [orderItem] = await connection.query(
        `SELECT unit_price FROM order_items WHERE id = ? AND order_id = ?`,
        [item.order_item_id, order_id],
      );
      if (!orderItem.length) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: `Invalid order_item_id ${item.order_item_id}`,
        });
      }
      refundAmount += orderItem[0].unit_price * item.quantity_returned;
    }

    const [result] = await connection.query(
      `INSERT INTO returns (order_id, user_id, return_reason, refund_amount, return_status)
       VALUES (?, ?, ?, ?, 'requested')`,
      [order_id, userId, return_reason, refundAmount],
    );
    const returnId = result.insertId;

    for (const item of items) {
      await connection.query(
        `INSERT INTO return_items (return_id, order_item_id, quantity_returned)
         VALUES (?, ?, ?)`,
        [returnId, item.order_item_id, item.quantity_returned],
      );
    }

    await connection.commit();
    res.status(201).json({ success: true, data: { return_id: returnId } });
  } catch (error) {
    await connection.rollback();
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  } finally {
    connection.release();
  }
};

// Admin/Staff: update return status (approve, reject, receive, issue refund)
export const updateReturnStatus = async (req, res) => {
  const { id } = req.params;
  const { return_status, refund_estimated_date, restocking_fees } = req.body;

  const allowedStatuses = ["approved", "rejected", "received", "refund_issued"];
  if (!allowedStatuses.includes(return_status)) {
    return res.status(400).json({ success: false, message: "Invalid status" });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [returnReq] = await connection.query(
      `SELECT * FROM returns WHERE id = ? FOR UPDATE`,
      [id],
    );
    if (!returnReq.length) {
      await connection.rollback();
      return res
        .status(404)
        .json({ success: false, message: "Return not found" });
    }

    let updateFields = `return_status = ?`;
    const params = [return_status];
    if (return_status === "approved") {
      updateFields += `, approved_at = NOW()`;
      if (refund_estimated_date) {
        updateFields += `, refund_estimated_date = ?`;
        params.push(refund_estimated_date);
      }
    } else if (return_status === "received") {
      updateFields += `, received_at = NOW()`;
    } else if (return_status === "refund_issued") {
      updateFields += `, refund_credited_at = NOW()`;
      if (refund_estimated_date) {
        updateFields += `, refund_estimated_date = ?`;
        params.push(refund_estimated_date);
      }
    }

    if (restocking_fees && return_status === "approved") {
      // Optionally store restocking fees per item
      for (const fee of restocking_fees) {
        console.log(fee);

        await connection.query(
          `UPDATE return_items SET restocking_fee = ? WHERE return_id = ? AND order_item_id = ?`,
          [fee.restocking_fee, id, fee.order_item_id],
        );
      }
    }

    params.push(id);
    await connection.query(
      `UPDATE returns SET ${updateFields} WHERE id = ?`,
      params,
    );

    // If refund issued, update order payment status
    if (return_status === "refund_issued") {
      await updateOrderRefundStatus(connection, returnReq[0].order_id);
    }

    await connection.commit();
    res.json({ success: true, message: "Return status updated" });
  } catch (error) {
    await connection.rollback();
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  } finally {
    connection.release();
  }
};

// Customer: get my return requests
export const getUserReturns = async (req, res) => {
  const userId = req.user.id;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;

  try {
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM returns WHERE user_id = ?`,
      [userId],
    );
    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit);

    const [returns] = await pool.query(
      `SELECT r.*, o.id  AS order_number
       FROM returns r
       JOIN orders o ON r.order_id = o.id
       WHERE r.user_id = ?
       ORDER BY r.requested_at DESC
       LIMIT ? OFFSET ?`,
      [userId, limit, offset],
    );

    res.json({
      success: true,
      data: returns,
      pagination: { page, limit, totalItems, totalPages },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Admin/Staff: get all returns with search/pagination
export const getAllReturns = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  const { search, return_status, order_id } = req.query;

  let whereClause = "1=1";
  const params = [];
  if (search) {
    whereClause += ` AND (o.id LIKE ? OR u.full_name LIKE ?)`;
    const pattern = `%${search}%`;
    params.push(pattern, pattern);
  }
  if (return_status) {
    whereClause += ` AND r.return_status = ?`;
    params.push(return_status);
  }
  if (order_id) {
    whereClause += ` AND r.order_id = ?`;
    params.push(order_id);
  }

  const [countResult] = await pool.query(
    `SELECT COUNT(*) as total FROM returns r JOIN orders o ON r.order_id = o.id JOIN users u ON r.user_id = u.id WHERE ${whereClause}`,
    params,
  );
  const totalItems = countResult[0].total;
  const totalPages = Math.ceil(totalItems / limit);

  const [returns] = await pool.query(
    `SELECT r.*, o.id AS order_number, u.full_name as customer_name, u.email as customer_email, u.phone as customer_phone
     FROM returns r
     JOIN orders o ON r.order_id = o.id
     JOIN users u ON r.user_id = u.id
     WHERE ${whereClause}
     ORDER BY r.requested_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  res.json({
    success: true,
    data: returns,
    pagination: { page, limit, totalItems, totalPages },
  });
};

// Get return details by ID (with items)
export const getReturnDetails = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    let query = `
      SELECT r.*, o.id AS order_number
      FROM returns r
      JOIN orders o ON r.order_id = o.id
      WHERE r.id = ?
    `;
    const params = [id];
    if (userRole === "Customer") {
      query += ` AND r.user_id = ?`;
      params.push(userId);
    }

    const [returnRows] = await pool.query(query, params);
    if (!returnRows.length) {
      return res
        .status(404)
        .json({ success: false, message: "Return not found" });
    }

    const [items] = await pool.query(
      `SELECT ri.*, oi.product_data_snapshot, oi.unit_price
       FROM return_items ri
       JOIN order_items oi ON ri.order_item_id = oi.id
       WHERE ri.return_id = ?`,
      [id],
    );

    res.json({ success: true, data: { ...returnRows[0], items } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
