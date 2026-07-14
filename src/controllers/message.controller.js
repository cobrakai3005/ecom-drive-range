import pool from "../config/db.js";

// CREATE MESSAGE
export const createMessage = async (req, res) => {
  try {
    const { full_name, email, phone, car_model, car_year, message } = req.body;

    if (!full_name || !email || !message) {
      return res.status(400).json({
        success: false,
        message: "Full name, email, and message are required",
      });
    }

    if (car_year) {
      const year = Number(car_year);
      const currentYear = new Date().getFullYear() + 1;

      if (!Number.isInteger(year) || year < 1900 || year > currentYear) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid car year",
        });
      }
    }

    const [result] = await pool.query(
      `INSERT INTO messages
        (
          full_name,
          email,
          phone,
          car_model,
          car_year,
          message
        )
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        full_name.trim(),
        email.trim().toLowerCase(),
        phone?.trim() || null,
        car_model?.trim() || null,
        car_year || null,
        message.trim(),
      ],
    );

    const [[createdMessage]] = await pool.query(
      `SELECT *
       FROM messages
       WHERE id = ?`,
      [result.insertId],
    );

    return res.status(201).json({
      success: true,
      message: "Message submitted successfully",
      data: createdMessage,
    });
  } catch (error) {
    console.error("Create message error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// GET ALL MESSAGES
export const getAllMessages = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query.limit, 10) || 10),
    );
    const offset = (page - 1) * limit;

    const search = req.query.search?.trim() || "";

    const conditions = [];
    const params = [];

    if (search) {
      conditions.push(`
        (
          full_name LIKE ?
          OR email LIKE ?
          OR phone LIKE ?
          OR car_model LIKE ?
          OR message LIKE ?
          OR CAST(car_year AS CHAR) LIKE ?
        )
      `);

      const searchValue = `%${search}%`;

      params.push(
        searchValue,
        searchValue,
        searchValue,
        searchValue,
        searchValue,
        searchValue,
      );
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const [countRows] = await pool.query(
      `SELECT COUNT(*) AS total
       FROM messages
       ${whereClause}`,
      params,
    );

    const [messages] = await pool.query(
      `SELECT
        id,
        full_name,
        email,
        phone,
        car_model,
        car_year,
        message,
        created_at
       FROM messages
       ${whereClause}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );

    const total = Number(countRows[0].total);
    const totalPages = Math.ceil(total / limit);

    return res.status(200).json({
      success: true,
      data: messages,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
    });
  } catch (error) {
    console.error("Get all messages error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// GET MESSAGE BY ID
export const getMessageById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!Number.isInteger(Number(id)) || Number(id) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid message ID",
      });
    }

    const [[message]] = await pool.query(
      `SELECT
        id,
        full_name,
        email,
        phone,
        car_model,
        car_year,
        message,
        created_at
       FROM messages
       WHERE id = ?`,
      [id],
    );

    if (!message) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: message,
    });
  } catch (error) {
    console.error("Get message by ID error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// UPDATE MESSAGE
export const updateMessage = async (req, res) => {
  try {
    const { id } = req.params;

    if (!Number.isInteger(Number(id)) || Number(id) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid message ID",
      });
    }

    const [[existingMessage]] = await pool.query(
      `SELECT *
       FROM messages
       WHERE id = ?`,
      [id],
    );

    if (!existingMessage) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    const allowedFields = [
      "full_name",
      "email",
      "phone",
      "car_model",
      "car_year",
      "message",
    ];

    const updates = [];
    const values = [];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        let value = req.body[field];

        if (typeof value === "string") {
          value = value.trim();
        }

        if (
          ["phone", "car_model", "car_year"].includes(field) &&
          value === ""
        ) {
          value = null;
        }

        if (field === "email" && value) {
          value = value.toLowerCase();
        }

        updates.push(`${field} = ?`);
        values.push(value);
      }
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Provide at least one field to update",
      });
    }

    const fullName =
      req.body.full_name !== undefined
        ? req.body.full_name?.trim()
        : existingMessage.full_name;

    const email =
      req.body.email !== undefined
        ? req.body.email?.trim()
        : existingMessage.email;

    const messageText =
      req.body.message !== undefined
        ? req.body.message?.trim()
        : existingMessage.message;

    if (!fullName || !email || !messageText) {
      return res.status(400).json({
        success: false,
        message: "Full name, email, and message cannot be empty",
      });
    }

    if (req.body.car_year !== undefined && req.body.car_year !== "") {
      const year = Number(req.body.car_year);
      const currentYear = new Date().getFullYear() + 1;

      if (!Number.isInteger(year) || year < 1900 || year > currentYear) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid car year",
        });
      }
    }

    values.push(id);

    await pool.query(
      `UPDATE messages
       SET ${updates.join(", ")}
       WHERE id = ?`,
      values,
    );

    const [[updatedMessage]] = await pool.query(
      `SELECT *
       FROM messages
       WHERE id = ?`,
      [id],
    );

    return res.status(200).json({
      success: true,
      message: "Message updated successfully",
      data: updatedMessage,
    });
  } catch (error) {
    console.error("Update message error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

// DELETE MESSAGE
export const deleteMessage = async (req, res) => {
  try {
    const { id } = req.params;

    if (!Number.isInteger(Number(id)) || Number(id) <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid message ID",
      });
    }

    const [[existingMessage]] = await pool.query(
      `SELECT id
       FROM messages
       WHERE id = ?`,
      [id],
    );

    if (!existingMessage) {
      return res.status(404).json({
        success: false,
        message: "Message not found",
      });
    }

    await pool.query(
      `DELETE FROM messages
       WHERE id = ?`,
      [id],
    );

    return res.status(200).json({
      success: true,
      message: "Message deleted successfully",
    });
  } catch (error) {
    console.error("Delete message error:", error);

    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
