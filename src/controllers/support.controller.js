import { pool } from "../config/db.js";

// Customer: create ticket
export const createTicket = async (req, res) => {
  const { order_id, subject, message, priority } = req.body;
  const userId = req.user.id;

  if (!subject || !message) {
    return res
      .status(400)
      .json({ success: false, message: "Subject and message required" });
  }

  const [existing] = await pool.query(
    `
    SELECT * FROM orders WHERE id = ? limit 1
    `,
    [order_id],
  );

  if (existing.length === 0) {
    return res
      .status(404)
      .json({ success: false, message: "No order Found" });
  }
  try {
    const [result] = await pool.query(
      `INSERT INTO support_tickets (user_id, order_id, subject, message, priority, ticket_status)
       VALUES (?, ?, ?, ?, ?, 'open')`,
      [userId, order_id || null, subject, message, priority || "medium"],
    );
    res
      .status(201)
      .json({ success: true, data: { ticket_id: result.insertId } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Customer: get my tickets
export const getUserTickets = async (req, res) => {
  const userId = req.user.id;
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;

  try {
    const [countResult] = await pool.query(
      `SELECT COUNT(*) as total FROM support_tickets WHERE user_id = ?`,
      [userId],
    );
    const totalItems = countResult[0].total;
    const totalPages = Math.ceil(totalItems / limit);

    const [tickets] = await pool.query(
      `SELECT * FROM support_tickets WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [userId, limit, offset],
    );
    res.json({
      success: true,
      data: tickets,
      pagination: { page, limit, totalItems, totalPages },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Add communication to a ticket (both customer and staff)
export const addCommunication = async (req, res) => {
  const { ticket_id, message_body, attachment_urls } = req.body;
  const userId = req.user.id;
  const userRole = req.user.role;

  if (!ticket_id || !message_body) {
    return res
      .status(400)
      .json({ success: false, message: "Ticket id and message required" });
  }

  try {
    // Verify ticket exists and user has access
    let query = `SELECT id FROM support_tickets WHERE id = ?`;
    const params = [ticket_id];
    if (userRole === "Customer") {
      query += ` AND user_id = ?`;
      params.push(userId);
    }
    const [ticket] = await pool.query(query, params);
    if (!ticket.length) {
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found" });
    }

    await pool.query(
      `INSERT INTO ticket_communications (ticket_id, author_user_id, message_body, attachment_urls)
       VALUES (?, ?, ?, ?)`,
      [
        ticket_id,
        userId,
        message_body,
        attachment_urls ? JSON.stringify(attachment_urls) : null,
      ],
    );

    // Update ticket status to 'in_progress' if it was 'open'
    await pool.query(
      `UPDATE support_tickets SET ticket_status = 'in_progress' WHERE id = ? AND ticket_status = 'open'`,
      [ticket_id],
    );

    res.status(201).json({ success: true, message: "Communication added" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Get ticket details with communications (for customer or admin/staff)
export const getTicketDetails = async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role;

  try {
    let ticketQuery = `SELECT * FROM support_tickets WHERE id = ?`;
    const params = [id];
    if (userRole === "Customer") {
      ticketQuery += ` AND user_id = ?`;
      params.push(userId);
    }
    const [tickets] = await pool.query(ticketQuery, params);
    if (!tickets.length) {
      return res
        .status(404)
        .json({ success: false, message: "Ticket not found" });
    }

    const [communications] = await pool.query(
      `SELECT tc.*, u.full_name as author_name
       FROM ticket_communications tc
       JOIN users u ON tc.author_user_id = u.id
       WHERE tc.ticket_id = ?
       ORDER BY tc.created_at ASC`,
      [id],
    );

    res.json({ success: true, data: { ...tickets[0], communications } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// Admin/Staff: get all tickets with filters
export const getAllTickets = async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const offset = (page - 1) * limit;
  const { status, priority, search } = req.query;

  let whereClause = "1=1";
  const params = [];
  if (status) {
    whereClause += ` AND ticket_status = ?`;
    params.push(status);
  }
  if (priority) {
    whereClause += ` AND priority = ?`;
    params.push(priority);
  }
  if (search) {
    whereClause += ` AND (subject LIKE ? OR message LIKE ? OR u.full_name LIKE ?)`;
    const pattern = `%${search}%`;
    params.push(pattern, pattern, pattern);
  }

  const [countResult] = await pool.query(
    `SELECT COUNT(*) as total FROM support_tickets t JOIN users u ON t.user_id = u.id WHERE ${whereClause}`,
    params,
  );
  const totalItems = countResult[0].total;
  const totalPages = Math.ceil(totalItems / limit);

  const [tickets] = await pool.query(
    `SELECT t.*, u.full_name as user_name
     FROM support_tickets t
     JOIN users u ON t.user_id = u.id
     WHERE ${whereClause}
     ORDER BY t.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  res.json({
    success: true,
    data: tickets,
    pagination: { page, limit, totalItems, totalPages },
  });
};

// Admin/Staff: update ticket status
export const updateTicketStatus = async (req, res) => {
  const { id } = req.params;
  const { ticket_status, priority } = req.body;
  const allowedStatuses = [
    "open",
    "in_progress",
    "resolved",
    "closed",
    "answered",
    "awaiting",
  ];
  if (ticket_status && !allowedStatuses.includes(ticket_status)) {
    return res.status(400).json({ success: false, message: "Invalid status" });
  }

  try {
    const updates = [];
    const params = [];
    if (ticket_status) {
      updates.push("ticket_status = ?");
      params.push(ticket_status);
      if (ticket_status === "resolved") updates.push("resolved_at = NOW()");
    }
    if (priority) {
      updates.push("priority = ?");
      params.push(priority);
    }
    if (!updates.length)
      return res
        .status(400)
        .json({ success: false, message: "No fields to update" });

    params.push(id);
    await pool.query(
      `UPDATE support_tickets SET ${updates.join(", ")} WHERE id = ?`,
      params,
    );
    res.json({ success: true, message: "Ticket updated" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
