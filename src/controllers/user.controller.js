import pool from "../config/db.js";

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
    const [users] = await pool.query(
      `SELECT id, email, phone, profile_image, role FROM users`,
    );

    return res.status(200).json({
      success: true,
      data: users,
    });
  } catch (error) {
    console.log(`Error in Geting the users ${error}`);

    return res.status(500).json({
      message: `Internal Server Error`,
      success: false,
    });
  }
};
