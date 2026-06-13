import { pool } from "../config/db.js";

const checkOwnership = async (addressId, userId) => {
  const [rows] = await pool.query(
    "SELECT user_id FROM user_addresses WHERE id = ? AND is_deleted = FALSE",
    [addressId],
  );
  return rows.length > 0 && rows[0].user_id === userId;
};
export const getAllAddresses = async (req, res) => {
  try {
    const { role, id: userId } = req.user;
    const { page = 1, limit = 10, search = "", type = "" } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const searchTerm = `%${search}%`;

    let baseQuery = `
      FROM user_addresses
      WHERE is_deleted = FALSE
    `;
    const params = [];

    // Role-based filter
    if (role === "Customer") {
      baseQuery += " AND user_id = ?";
      params.push(userId);
    }

    // Search filter (multiple columns)
    if (search) {
      baseQuery += ` AND (
        full_name LIKE ? OR phone LIKE ? OR line1 LIKE ? OR 
        city LIKE ? OR state LIKE ? OR postal_code LIKE ? OR landmark LIKE ?
      )`;
      for (let i = 0; i < 7; i++) params.push(searchTerm);
    }

    // Address type filter
    if (type && ["billing", "shipping", "returns"].includes(type)) {
      baseQuery += " AND address_type = ?";
      params.push(type);
    }

    // Count total matching records
    const countQuery = `SELECT COUNT(*) as total ${baseQuery}`;
    const [countResult] = await pool.query(countQuery, params);
    const total = countResult[0].total;

    // Fetch paginated data
    const dataQuery = `
      SELECT * ${baseQuery}
      ORDER BY is_default DESC, created_at DESC
      LIMIT ? OFFSET ?
    `;
    const dataParams = [...params, parseInt(limit), offset];
    const [rows] = await pool.query(dataQuery, dataParams);

    res.json({
      success: true,
      data: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
export const getAddressById = async (req, res) => {
  try {
    const { addressId } = req.params;
    const { role, id: userId } = req.user;

    const [rows] = await pool.query(
      "SELECT * FROM user_addresses WHERE id = ? AND is_deleted = FALSE",
      [addressId],
    );
    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Address not found" });
    }
    const address = rows[0];

    // Customer: only own address; Admin: any; Delivery agent: handled separately below
    if (role === "Customer" && address.user_id !== userId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    // // For delivery agents – we skip here; they should use a dedicated order endpoint
    // if (role === "delivery") {
    //   return res.status(403).json({ success: false, message: "Not allowed" });
    // }
    res.json({ success: true, data: address });
  } catch (error) {
    console.log(error);

    res.status(500).json({ success: false, message: "Server error" });
  }
};
export const createAddress = async (req, res) => {
  try {
    const { role, id: userIdFromToken } = req.user;
    let targetUserId;

    if (role === "Customer") {
      targetUserId = userIdFromToken;
    } else if (role === "Admin") {
      // Admin must specify which user the address belongs to
      const { user_id } = req.body;
      if (!user_id) {
        return res
          .status(400)
          .json({ success: false, message: "user_id required for admin" });
      }
      // Optionally check that user exists
      const [userExists] = await pool.query(
        "SELECT id FROM users WHERE user_id = ?",
        [user_id],
      );
      if (userExists.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "User not found" });
      }
      targetUserId = user_id;
    } else {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const {
      address_type,
      full_name,
      phone,
      line1,
      line2,
      landmark,
      city,
      state,
      postal_code,
      country = "India",
      is_default = false,
    } = req.body;
    const userId = req.user.id;

    // Input validation (basic)
    if (
      !address_type ||
      !full_name ||
      !phone ||
      !line1 ||
      !city ||
      !state ||
      !postal_code
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Missing required fields" });
    }
    if (!["billing", "shipping", "returns"].includes(address_type)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid address_type" });
    }
    if (!/^[1-9][0-9]{5}$/.test(postal_code)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid PIN code" });
    }

    // If is_default is true, unset any existing default for this user+type
    if (is_default) {
      await pool.query(
        "UPDATE user_addresses SET is_default = FALSE WHERE user_id = ? AND address_type = ? AND is_deleted = FALSE",
        [userId, address_type],
      );
    }

    const [result] = await pool.query(
      `INSERT INTO user_addresses 
       (user_id, address_type, full_name, phone, line1, line2, landmark,
        city, state, postal_code, country, is_default, is_deleted)
       VALUES ( ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE)`,
      [
        userId,
        address_type,
        full_name,
        phone,
        line1,
        line2 || null,
        landmark || null,
        city,
        state,
        postal_code,
        country,
        is_default,
      ],
    );

    const [newAddress] = await pool.query(
      "SELECT * FROM user_addresses WHERE id = ?",
      [result.insertId],
    );
    res.status(201).json({ success: true, data: newAddress[0] });
  } catch (error) {
    console.log(error);

    res.status(500).json({ success: false, message: "Server error" });
  }
};
export const updateAddress = async (req, res) => {
  try {
    console.log("reached******************************");

    const { addressId } = req.params;
    const { role, id: userId } = req.user;

    // Check existence and ownership
    const [existing] = await pool.query(
      "SELECT user_id FROM user_addresses WHERE id = ? AND is_deleted = FALSE",
      [addressId],
    );
    if (existing.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Address not found" });
    }
    if (role === "Customer" && existing[0].user_id !== userId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const allowedUpdates = [
      "full_name",
      "phone",
      "line1",
      "line2",
      "landmark",
      "city",
      "state",
      "postal_code",
      "country",
      "is_default",
    ];
    const updates = [];
    const values = [];
    for (const field of allowedUpdates) {
      if (req.body[field] !== undefined) {
        updates.push(`${field} = ?`);
        values.push(req.body[field]);
      }
    }
    if (updates.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "No fields to update" });
    }

    // If updating is_default to true, unset previous default for same user+type

    if (req.body.is_default === true) {
      const ownerId = existing[0].user_id;
      const [addrTypeRow] = await pool.query(
        "SELECT address_type FROM user_addresses WHERE id = ?",
        [addressId],
      );
      const addrType = addrTypeRow[0].address_type;
      await pool.query(
        "UPDATE user_addresses SET is_default = FALSE WHERE user_id = ? AND address_type = ? AND is_deleted = FALSE",
        [ownerId, addrType],
      );
    }

    values.push(addressId);
    const query = `UPDATE user_addresses SET ${updates.join(", ")} WHERE id = ?`;
    await pool.query(query, values);

    const [updated] = await pool.query(
      "SELECT * FROM user_addresses WHERE id = ?",
      [addressId],
    );
    res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.log(error);
    res.status(500).json({ success: false, message: "Server error update" });
  }
};
export const deleteAddress = async (req, res) => {
  try {
    const { addressId } = req.params;
    const { role, id: userId } = req.user;

    const [existing] = await pool.query(
      "SELECT user_id FROM user_addresses WHERE id = ? AND is_deleted = FALSE",
      [addressId],
    );
    if (existing.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Address not found" });
    }
    if (role === "Customer" && existing[0].user_id !== userId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    await pool.query(
      "UPDATE user_addresses SET is_deleted = TRUE WHERE id = ?",
      [addressId],
    );
    res.json({ success: true, message: "Address deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Server error" });
  }
};
export const deleveryAddress = async (req, res) => {};
