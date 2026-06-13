import pool from "../config/db.js";
import { generateOtp } from "../lib/otp.js";
import jwt from "jsonwebtoken";
import cloudinary from "../config/cloudinary.js";
const fiveMinutes = 5 * 60 * 1000;

export const testController = (req, res) => {
  return res.json("Test Controller");
};
export const registerController = async (req, res) => {
  try {
    const { username, phone, password, full_name } = req?.body;

    if (!username || !phone || !password || !full_name) {
      return res.json(400, {
        success: false,
        message: "Please fill all fields",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        message: `Password length must be at least 6 characters`,
        success: false,
      });
    }

    if (phone.length !== 10) {
      return res.status(400).json({
        message: `Phone number must be 10 digits`,
        success: false,
      });
    }

    const profile_image = req.file?.path || null;
    const profile_image_id = req.file?.filename || null;
    // Check if user already exists
    const getUserbyPhoneAndUsername = `SELECT * FROM users WHERE phone = ? OR username = ?`;
    const [userRows] = await pool.query(getUserbyPhoneAndUsername, [
      phone,
      username,
    ]);

    if (userRows.length > 0) {
      return res.status(400).json({
        message: "User already exists",
        success: false,
      });
    }
    const otp = generateOtp();
    const otpExpire = new Date(Date.now() + fiveMinutes);
    // Insert new user
    const insertQuery = `
             INSERT INTO users (full_name, username, profile_image, phone, otp, otp_expire, profile_image_id, password)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         `;
    const [result] = await pool.query(insertQuery, [
      full_name,
      username,
      profile_image,
      phone,
      otp,
      otpExpire,
      profile_image_id,
      password,
    ]);

    // Fetch the newly created user (MySQL equivalent of RETURNING *)
    const [newUserRows] = await pool.query(`SELECT * FROM users WHERE id = ?`, [
      result.insertId,
    ]);

    res.status(201).json({
      message: `Enter OTP sent to ${phone}`,
      otp,
      success: true,
      data: newUserRows[0],
    });
  } catch (error) {
    res.status(50).json({
      message: `Internal Server Error`,
      success: false,
    });
  }

  return res.json("Test Controller");
};
export const verifyOTP = async (req, res) => {
  try {
    console.log(req?.body);
    const { phone, otp } = req?.body;

    if (!phone || !otp) {
      return res.status(400).json({
        message: "All fields are required",
        success: false,
      });
    }

    if (phone.length !== 10) {
      return res.status(400).json({
        message: `Phone number must be 10 digits`,
        success: false,
      });
    }

    const [userRows] = await pool.query(`SELECT * FROM users WHERE phone = ?`, [
      phone,
    ]);

    if (userRows.length <= 0) {
      return res.status(400).json({
        message: "User not found with this number",
        success: false,
      });
    }

    const existingUser = userRows[0];

    console.log(existingUser);
    console.log(otp);

    // const existingUser = userRows[0];
    if (existingUser.is_delete) {
      return res.status(400).json({
        success: false,
        message: "You can't do this operation Because Admin Deactivate you",
      });
    }

    if (existingUser.otp != otp) {
      return res.status(400).json({
        message: "Invalid OTP",
        success: false,
      });
    }

    console.log(existingUser);
    console.log(Date(Date.now()));

    // Compare expiry (MySQL datetime vs JS Date)
    if (new Date(existingUser.otp_expire) < new Date()) {
      return res.status(400).json({
        message: "OTP has expired",
        success: false,
      });
    }

    await pool.query(
      `UPDATE users 
   SET otp_verify = true,
       otp = NULL,
       otp_expire = NULL
   WHERE phone = ?`,
      [phone],
    );

    res.status(200).json({
      message: "OTP verified successfully",
      success: true,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const login = async (req, res) => {
  try {
    const { username, password } = req?.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const [userRows] = await pool.query(
      `SELECT * FROM users WHERE username = ?`,
      [username],
    );

    if (userRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const existingUser = userRows[0];

    if (!existingUser.otp_verify) {
      return res.status(400).json({
        success: false,
        message: "Please verify your phone number first",
      });
    }

    if (existingUser.is_delete) {
      return res.status(400).json({
        success: false,
        message: "You can't do this operation Because Admin Deactivate you",
      });
    }

    const isMatch = password === existingUser.password;
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    const token = jwt.sign(
      {
        id: existingUser.id,
        phone: existingUser.phone,
        role: existingUser.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "1d" },
    );

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
      maxAge: 24 * 60 * 60 * 1000,
    });

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: existingUser.id,
        username: existingUser.username,
        full_name: existingUser.full_name,
        phone: existingUser.phone,
        profile_image: existingUser.profile_image,
        role: existingUser.role,
      },
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const resendOtp = async (req, res) => {
  try {
    const { phone } = req?.body;

    if (!phone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    if (phone.length !== 10) {
      return res.status(400).json({
        message: `Phone number must be 10 digits`,
        success: false,
      });
    }

    const [userRows] = await pool.query(`SELECT * FROM users WHERE phone = ?`, [
      phone,
    ]);

    if (userRows.length <= 0) {
      return res.status(400).json({
        success: false,
        message: "No user found",
      });
    }
    const existingUser = userRows[0];
    if (existingUser.is_delete) {
      return res.status(400).json({
        success: false,
        message: "You can't do this operation Because Admin Deactivate you",
      });
    }

    const otp = generateOtp();
    const otpExpire = new Date(Date.now() + 5 * 60 * 1000);

    await pool.query(
      `UPDATE users SET otp = ?, otp_expire = ? WHERE phone = ?`,
      [otp, otpExpire, phone],
    );

    // Fetch updated user to return
    const [updatedRows] = await pool.query(
      `SELECT * FROM users WHERE phone = ?`,
      [phone],
    );

    res.status(201).json({
      message: `OTP resent successfully to ${phone}`,
      success: true,
      data: updatedRows[0],
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const forgetPassword = async (req, res) => {
  try {
    const { phone, otp, password, confirmPassword } = req?.body;

    if (!phone || !otp || !password || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    if (phone.length !== 10) {
      return res.status(400).json({
        message: `Phone number must be 10 digits`,
        success: false,
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match",
      });
    }

    const [userRows] = await pool.query(`SELECT * FROM users WHERE phone = ?`, [
      phone,
    ]);

    if (userRows.length <= 0) {
      return res.status(400).json({
        success: false,
        message: "No user found",
      });
    }

    const existingUser = userRows[0];

    if (existingUser.otp !== otp) {
      return res.status(400).json({
        success: false,
        message: "Wrong OTP",
      });
    }

    // const existingUser = userRows[0];
    if (existingUser.is_delete) {
      return res.status(400).json({
        success: false,
        message: "You can't do this operation Because Admin Deactivate you",
      });
    }

    if (new Date(existingUser.otp_expire) < new Date()) {
      return res.status(400).json({
        success: false,
        message: "OTP has expired",
      });
    }

    await pool.query(`UPDATE users SET password = ? WHERE phone = ?`, [
      password,
      phone,
    ]);

    // Fetch updated user
    const [updatedRows] = await pool.query(
      `SELECT * FROM users WHERE phone = ?`,
      [phone],
    );

    res.status(201).json({
      message: `Password changed successfully`,
      success: true,
      data: updatedRows[0],
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const updateProfileImage = async (req, res) => {
  try {
    const userId = req.user.id;
    const profile_image = req.file?.path;
    const profile_image_id = req.file?.filename;

    if (!profile_image || !profile_image_id) {
      return res.status(400).json({
        success: false,
        message: "Please upload a profile image",
      });
    }

    const [userRows] = await pool.query(`SELECT * FROM users WHERE id = ?`, [
      userId,
    ]);

    if (userRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    const existingUser = userRows[0];

    // const existingUser = userRows[0];
    if (existingUser.is_delete) {
      return res.status(400).json({
        success: false,
        message: "You can't do this operation Because Admin Deactivate you",
      });
    }

    // Delete old image from cloudinary if exists
    if (existingUser.profile_image_id) {
      await cloudinary.uploader.destroy(existingUser.profile_image_id);
    }

    await pool.query(
      `UPDATE users SET profile_image = ?, profile_image_id = ? WHERE id = ?`,
      [profile_image, profile_image_id, userId],
    );

    // Fetch updated user
    const [updatedRows] = await pool.query(`SELECT * FROM users WHERE id = ?`, [
      userId,
    ]);

    return res.status(200).json({
      success: true,
      message: "Profile image updated successfully",
      data: updatedRows[0],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const logout = async (req, res) => {
  try {
    res.clearCookie("token", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    });

    return res.status(200).json({
      success: true,
      message: "Logout successful",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
