import { pool } from "../config/db.js";
import cloudinary from "../config/cloudinary.js";

// ========== CREATE USER (no OTP) ==========
export const createUser = async (req, res) => {
  try {
    const { phone, email, password, full_name, role = "Customer" } = req.body;

    // --- validation ---
    if (!phone || !email || !password || !full_name) {
      return res.status(400).json({
        success: false,
        message:
          "Please fill all required fields (phone, email, password, full_name)",
      });
    }
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }
    if (phone.length !== 10) {
      return res.status(400).json({
        success: false,
        message: "Phone number must be 10 digits",
      });
    }

    const profile_image = req.file?.path || null;
    const profile_image_id = req.file?.filename || null;

    // --- check existing ---
    const [existing] = await pool.query(
      "SELECT id FROM users WHERE phone = ? OR email = ?",
      [phone, email],
    );
    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message: "User with this phone or email already exists",
      });
    }

    const insertQuery = `
      INSERT INTO users 
        (full_name, email, profile_image, phone, profile_image_id, password, role)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;
    const [result] = await pool.query(insertQuery, [
      full_name,
      email,
      profile_image,
      phone,
      profile_image_id,
      password,
      role,
    ]);

    const [newUser] = await pool.query(
      `SELECT id, full_name, email, phone, profile_image, role, created_at, updated_at
       FROM users WHERE id = ?`,
      [result.insertId],
    );

    res.status(201).json({
      success: true,
      message: "User created successfully",
      data: newUser[0],
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
};

// ========== GET ALL USERS (with pagination & search) ==========
export const getAllUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const role = req.query.role;
    const status = req.query.status; // 'active' or 'inactive' or undefined
    const offset = (page - 1) * limit;

    let whereConditions = [];
    let params = [];

    // Status filter: active (default) or inactive
    if (status === "inactive") {
      whereConditions.push("is_delete = TRUE");
    } else {
      // default: active (include only non-deleted)
      whereConditions.push("is_delete = FALSE");
    }

    if (search) {
      whereConditions.push(
        "(full_name LIKE ? OR email LIKE ? OR phone LIKE ?)",
      );
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    if (role) {
      whereConditions.push("role = ?");
      params.push(role);
    }

    const whereClause = `WHERE ${whereConditions.join(" AND ")}`;

    // Count total
    const countQuery = `SELECT COUNT(*) as total FROM users ${whereClause}`;
    const [countResult] = await pool.query(countQuery, params);
    const total = countResult[0].total;

    // Fetch data
    const dataQuery = `
      SELECT id, role, profile_image, phone, full_name, email,is_delete,
             otp_verify, profile_image_id, created_at, updated_at
      FROM users 
      ${whereClause}
      ORDER BY created_at DESC
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
    console.error(error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ========== GET USER BY ID ==========
export const getUserById = async (req, res) => {
  const { id } = req.params;
  try {
    const [rows] = await pool.query(
      `SELECT id, role, profile_image, phone, full_name, email,
              otp_verify, profile_image_id, created_at, updated_at
       FROM users 
       WHERE id = ? AND is_delete = FALSE`,
      [id],
    );
    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ========== UPDATE USER (with role restriction) ==========
export const updateUser = async (req, res) => {
  const { id } = req.params;
  const {
    role,
    profile_image,
    phone,
    full_name,
    email,
    password,
    otp,
    otp_verify,
    otp_expire,
    profile_image_id,
  } = req.body;

  // --- Get the logged-in user from auth middleware ---
  // Assumes req.user is set by authentication middleware (e.g., verifyToken)
  const loggedInUser = req.user; // { id, role, ... }

  // If no user context, assume no permission (or you can skip this check)
  if (!loggedInUser) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized - no user context",
    });
  }

  try {
    const fields = [];
    const values = [];

    // --- Handle role update: only Admin can change role ---
    if (role !== undefined) {
      if (loggedInUser.role !== "Admin") {
        return res.status(403).json({
          success: false,
          message: "Forbidden: Only Admin can change user role",
        });
      }
      fields.push("role = ?");
      values.push(role);
    }

    // --- Handle other fields (allowed for all authenticated users) ---
    if (profile_image !== undefined) {
      fields.push("profile_image = ?");
      values.push(profile_image);
    }
    if (phone !== undefined) {
      fields.push("phone = ?");
      values.push(phone);
    }
    if (full_name !== undefined) {
      fields.push("full_name = ?");
      values.push(full_name);
    }
    if (email !== undefined) {
      fields.push("email = ?");
      values.push(email);
    }
    if (password) {
      fields.push("password = ?");
      values.push(password);
    }
    if (otp !== undefined) {
      fields.push("otp = ?");
      values.push(otp);
    }
    if (otp_verify !== undefined) {
      fields.push("otp_verify = ?");
      values.push(otp_verify ? 1 : 0);
    }
    if (otp_expire !== undefined) {
      fields.push("otp_expire = ?");
      values.push(otp_expire);
    }
    if (profile_image_id !== undefined) {
      fields.push("profile_image_id = ?");
      values.push(profile_image_id);
    }

    if (fields.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No fields to update",
      });
    }

    values.push(id);

    const [result] = await pool.query(
      `UPDATE users SET ${fields.join(", ")} WHERE id = ? AND is_delete = FALSE`,
      values,
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found or already deleted",
      });
    }

    res.json({ success: true, message: "User updated" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * PUT /api/update-profile
 * Update authenticated user's own profile.
 * Allowed fields: full_name, phone, email (optional)
 * Profile image: handled via multer (field 'profile_image')
 * Role and other sensitive fields are not allowed.
 */
// controllers/profileController.js

export const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { full_name } = req.body; // only full_name is allowed
    const file = req.file; // profile_image (optional)

    // --- Step 1: Get current user data ---
    const [currentRows] = await pool.query(
      `SELECT id, full_name, profile_image, profile_image_id 
       FROM users WHERE id = ? AND is_delete = FALSE`,
      [userId],
    );
    if (currentRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found or already deleted.",
      });
    }
    const currentUser = currentRows[0];

    // --- Step 2: Prepare update fields and values ---
    const fields = [];
    const values = [];

    // Helper to add field if value is provided and changed
    const addFieldIfChanged = (field, newValue, currentValue) => {
      if (newValue !== undefined && newValue !== null && newValue !== "") {
        if (newValue !== currentValue) {
          fields.push(`${field} = ?`);
          values.push(newValue);
          return true;
        }
      }
      return false;
    };

    // Only update full_name (email and phone are NOT allowed)
    addFieldIfChanged("full_name", full_name, currentUser.full_name);

    // --- Step 3: Handle profile image (if a new file is uploaded) ---
    let oldImageId = currentUser.profile_image_id;

    if (file) {
      try {
        // Delete old image from Cloudinary if it exists
        if (oldImageId) {
          await cloudinary.uploader.destroy(oldImageId);
        }

        // Upload the new file to Cloudinary
        const uploadResult = await cloudinary.uploader.upload(
          file.path || file.buffer,
          {
            folder: "profile_images",
            public_id: `user_${userId}_${Date.now()}`,
          },
        );

        fields.push("profile_image = ?", "profile_image_id = ?");
        values.push(uploadResult.secure_url, uploadResult.public_id);
      } catch (uploadError) {
        console.error("Cloudinary error:", uploadError);
        return res.status(500).json({
          success: false,
          message: "Failed to process profile image.",
        });
      }
    }

    // --- Step 4: If no fields to update, return early ---
    if (fields.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No changes to update.",
        data: currentUser,
      });
    }

    // --- Step 5: Execute update ---
    values.push(userId);
    const updateQuery = `UPDATE users SET ${fields.join(", ")} WHERE id = ? AND is_delete = FALSE`;
    const [result] = await pool.query(updateQuery, values);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "Update failed, user not found.",
      });
    }

    // --- Step 6: Fetch updated user data (excluding sensitive) ---
    const [updatedRows] = await pool.query(
      `SELECT id, role, profile_image, phone, full_name, email, 
              profile_image_id, created_at, updated_at
       FROM users WHERE id = ? AND is_delete = FALSE`,
      [userId],
    );

    return res.status(200).json({
      success: true,
      message: "Profile updated successfully.",
      data: updatedRows[0],
    });
  } catch (error) {
    console.error("Update profile error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while updating profile.",
    });
  }
};

/**
 * POST /api/change-password
 * Change password for authenticated user.
 * Requires: currentPassword, newPassword, confirmPassword
 */
export const changePassword = async (req, res) => {
  try {
    console.log(req.body);
    
    const userId = req.user.id;
    const { currentPassword, newPassword, confirmPassword } = req.body;

    // --- Validation ---
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "All fields are required.",
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "New password must be at least 6 characters long.",
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "New password and confirm password do not match.",
      });
    }

    // --- Fetch current user with password ---
    const [userRows] = await pool.query(
      "SELECT id, password FROM users WHERE id = ? AND is_delete = FALSE",
      [userId],
    );
    if (userRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found or deleted.",
      });
    }
    const user = userRows[0];

    // --- Verify current password ---
    const isMatch = currentPassword === user.password;
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect.",
      });
    }

    // --- Update password ---
    await pool.query("UPDATE users SET password = ? WHERE id = ?", [
      newPassword,
      userId,
    ]);

    return res.status(200).json({
      success: true,
      message: "Password changed successfully.",
    });
  } catch (error) {
    console.error("Change password error:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
    });
  }
};

// ========== DELETE USER (soft delete) ==========
export const deleteUser = async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await pool.query("DELETE FROM  users  WHERE id = ?", [id]);
    if (result.affectedRows === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
    res.json({ success: true, message: "User deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deactivateUser = async (req, res) => {
  try {
    const { id } = req.params;

    const [user] = await pool.query(
      `
        SELECT *
        FROM users
        WHERE id = ?
        LIMIT 1
        `,
      [id],
    );

    if (user.length === 0) {
      return res.status(404).json({
        message: `User not found`,
        success: false,
      });
    }
    const existing = user[0];
    if (existing.is_delete === 0) {
      await pool.query(
        `
        UPDATE users
        SET is_delete = TRUE
        WHERE id = ?
        `,
        [id],
      );
    } else {
      await pool.query(
        `
        UPDATE users
        SET is_delete = FALSE
        WHERE id = ?
        `,
        [id],
      );
    }

    return res.status(200).json({
      message: `User Active Toggled`,
      success: true,
    });
  } catch (error) {
    console.log(`Error in Deactivating the user ${error}`);

    return res.status(500).json({
      message: `Internal Server Error`,
      success: false,
    });
  }
};

export const getUsers = async (req, res) => {
  try {
    // 1. Parse query parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || "";
    const status = req.query.status || "active"; // default to active
    const offset = (page - 1) * limit;

    // 2. Build WHERE conditions and parameters
    const whereConditions = [];
    const params = [];

    // Search condition (matches full_name, email, or phone)
    if (search.trim() !== "") {
      whereConditions.push(
        "(full_name LIKE ? OR email LIKE ? OR phone LIKE ?)",
      );
      const likeTerm = `%${search.trim()}%`;
      params.push(likeTerm, likeTerm, likeTerm);
    }

    // Status filter (based on is_delete)
    if (status === "active") {
      whereConditions.push("is_delete = 0");
    } else if (status === "inactive") {
      whereConditions.push("is_delete = 1");
    }
    // if status === 'all', we add no condition on is_delete

    const whereClause =
      whereConditions.length > 0
        ? `WHERE ${whereConditions.join(" AND ")}`
        : "";

    // 3. Count total matching records (for pagination)
    const countQuery = `SELECT COUNT(*) as total FROM users ${whereClause}`;
    const [countResult] = await pool.query(countQuery, params);
    const total = countResult[0].total;

    // 4. Fetch paginated data
    const dataQuery = `
      SELECT id, full_name, email, phone, is_delete, profile_image, role
      FROM users
      ${whereClause}
      ORDER BY full_name ASC
      LIMIT ? OFFSET ?
    `;
    const dataParams = [...params, limit, offset];
    const [rows] = await pool.query(dataQuery, dataParams);

    // 5. Send response with pagination metadata
    return res.status(200).json({
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
    console.error("Error in getUsers:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
    });
  }
};

// My Profile

export const getProfile = async (req, res, next) => {
  try {
    const userId = req.user.id;

    // Query to fetch user details, excluding sensitive columns
    const [rows] = await pool.query(
      `SELECT 
        id,
        role,
        profile_image,
        phone,
        full_name,
        email,
        profile_image_id,
        created_at,
        updated_at
      FROM users
      WHERE id = ? AND is_delete = FALSE`,
      [userId],
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found or has been deleted.",
      });
    }

    const user = rows[0];

    return res.status(200).json({
      success: true,
      data: user,
    });
  } catch (error) {
    console.error("Error fetching user profile:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error while fetching profile.",
    });
  }
};
