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

    // Parse query parameters with defaults
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const type = req.query.type || ""; // 'billing', 'shipping', 'returns'
    const status = req.query.status || "active"; // 'active', 'deleted', 'all'
    const offset = (page - 1) * limit;

    const params = [];
    const whereConditions = [];

    // 1. Base condition (soft delete) – controlled by status
    if (status === "active") {
      whereConditions.push("is_deleted = 0");
    } else if (status === "inactive") {
      whereConditions.push("is_deleted = 1");
    }
    // if status === 'all', we add no condition on is_deleted

    // 2. Role‑based filter (customer sees only own addresses)
    if (role === "Customer") {
      whereConditions.push("user_id = ?");
      params.push(userId);
    }

    // 3. Search filter (multiple columns)
    if (search.trim() !== "") {
      const likeTerm = `%${search.trim()}%`;
      whereConditions.push(
        `(full_name LIKE ? OR phone LIKE ? OR line1 LIKE ? OR city LIKE ? OR state LIKE ? OR postal_code LIKE ? OR landmark LIKE ?)`,
      );
      // Push the same term for each column (7 times)
      for (let i = 0; i < 7; i++) params.push(likeTerm);
    }

    // 4. Address type filter
    if (type && ["billing", "shipping", "returns"].includes(type)) {
      whereConditions.push("address_type = ?");
      params.push(type);
    }

    // Build the WHERE clause
    const whereClause =
      whereConditions.length > 0
        ? `WHERE ${whereConditions.join(" AND ")}`
        : "";

    // 5. Count total matching records
    const countQuery = `SELECT COUNT(*) as total FROM user_addresses ${whereClause}`;
    const [countResult] = await pool.query(countQuery, params);
    const total = countResult[0].total;

    // 6. Fetch paginated data
    const dataQuery = `
      SELECT * FROM user_addresses
      ${whereClause}
      ORDER BY is_default DESC, created_at DESC
      LIMIT ? OFFSET ?
    `;
    const dataParams = [...params, limit, offset];
    const [rows] = await pool.query(dataQuery, dataParams);

    // 7. Send response
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
    console.error("Error in getAllAddresses:", error);
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
        "SELECT id FROM users WHERE id = ?",
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
// export const deleteAddress = async (req, res) => {
//   try {
//     const { addressId } = req.params;
//     const { role, id: userId } = req.user;

//     const [existing] = await pool.query(
//       "SELECT user_id FROM user_addresses WHERE id = ? AND is_deleted = FALSE",
//       [addressId],
//     );
//     console.log(existing);

//     if (existing.length === 0) {
//       return res
//         .status(404)
//         .json({ success: false, message: "Address not found" });
//     }
//     if (role === "Customer" && existing[0].user_id !== userId) {
//       return res.status(403).json({ success: false, message: "Forbidden" });
//     }

//     await pool.query(
//       "UPDATE user_addresses SET is_deleted = TRUE WHERE id = ?",
//       [addressId],
//     );
//     res.json({ success: true, message: "Address deleted" });
//   } catch (error) {
//     res.status(500).json({ success: false, message: "Server error" });
//   }
// };
export const deleteAddress = async (req, res) => {
  try {
    const { addressId } = req.params;
    const { role, id: userId } = req.user;

    // 1. Find the address (no filter on is_deleted)
    const [existing] = await pool.query(
      "SELECT id, user_id, is_deleted FROM user_addresses WHERE id = ?",
      [addressId],
    );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Address not found",
      });
    }

    const address = existing[0];

    // 2. Permission check: Customers can only toggle their own addresses
    if (role === "Customer" && address.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    // 3. Toggle is_deleted
    const newDeletedStatus = address.is_deleted ? 0 : 1; // flip the bit
    await pool.query("UPDATE user_addresses SET is_deleted = ? WHERE id = ?", [
      newDeletedStatus,
      addressId,
    ]);

    // 4. Build response message
    const message = newDeletedStatus
      ? "Address deleted (soft)"
      : "Address restored";

    res.json({
      success: true,
      message,
      is_deleted: !!newDeletedStatus, // boolean for frontend convenience
    });
  } catch (error) {
    console.error("Error in deleteAddress (toggle):", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};
export const deleveryAddress = async (req, res) => {};
