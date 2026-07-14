import pool from "../config/db.js";
import { generateOtp } from "../lib/otp.js";
import jwt from "jsonwebtoken";
import cloudinary from "../config/cloudinary.js";
import { sendOTPEmail } from "../services/nodemailer.service.js";
import { deleteImage } from "../utils/deleteImages.js";
const fiveMinutes = 1 * 60 * 1000;

export const getMe = (req, res) => {
  return res.json(req.user);
};
export const registerController = async (req, res) => {
  try {
    console.log(req.file);
    const { phone, email, password, full_name } = req?.body;

    if (!email || !phone || !password || !full_name) {
      return res.json(400, {
        success: false,
        message: "Please fill all fields",
      });
    }

    if (password.length < 6 || password.length > 10) {
      return res.status(400).json({
        message: `Password length must be at least 6 characters or maximum 10 characters`,
        success: false,
      });
    }

    if (phone.length !== 10) {
      return res.status(400).json({
        message: `Phone number must be 10 digits`,
        success: false,
      });
    }

    // const profile_image = req.file?.path || null;
    // const profile_image_id = req.file?.filename || null;

    const profile_image = req.file
      ? `${req.protocol}://${req.get("host")}/uploads/profile_images/${req.file.filename}`
      : null;
    // Check if user already exists
    const getUserbyPhoneAndEmail = `SELECT * FROM users WHERE phone = ? OR email = ?`;
    const [userRows] = await pool.query(getUserbyPhoneAndEmail, [phone, email]);

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
             INSERT INTO users (full_name, email, profile_image, phone, otp, otp_expire, password)
             VALUES (?, ?, ?, ?, ?, ?, ?)
         `;
    const [result] = await pool.query(insertQuery, [
      full_name,
      email,
      profile_image,
      phone,
      otp,
      otpExpire,
      password,
    ]);

    // Fetch the newly created user (MySQL equivalent of RETURNING *)
    const [newUserRows] = await pool.query(`SELECT * FROM users WHERE id = ?`, [
      result.insertId,
    ]);

    // Send OTP email
    //await sendOTPEmail(email, otp);

    return res.status(201).json({
      message: `Enter OTP sent to ${email}`,
      otp,
      success: true,
      data: newUserRows[0],
    });
  } catch (error) {
    console.log(error);

    res.status(500).json({
      message: `Internal Server Error`,
      success: false,
    });
  }
};

export const login = async (req, res) => {
  try {
    const { email, password } = req?.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    const [userRows] = await pool.query(`SELECT * FROM users WHERE email = ?`, [
      email,
    ]);

    if (userRows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Inavalid Credentials",
      });
    }

    const existingUser = userRows[0];

    const isMatch = password === existingUser.password;
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Invalid credentials",
      });
    }

    if (!existingUser.otp_verify) {
      return res.status(400).json({
        success: false,
        message: "Please verify your Email  first",
      });
    }

    if (existingUser.is_delete) {
      return res.status(400).json({
        success: false,
        message: "You can't do this operation Because Admin Deactivate you",
      });
    }

    const token = jwt.sign(
      {
        id: existingUser.id,
        phone: existingUser.phone,
        email: existingUser.email,
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

    // Merge Cart

    const userId = existingUser.id;

    const sessionToken = req.headers["x-session-token"] || null;

    if (sessionToken) {
      const [guestCartRows] = await pool.query(
        `SELECT * FROM cart WHERE session_token = ?`,
        [sessionToken],
      );

      if (guestCartRows.length) {
        const guestCart = guestCartRows[0];

        const guestItems =
          typeof guestCart.items === "string"
            ? JSON.parse(guestCart.items || "[]")
            : guestCart.items || [];

        const [userCartRows] = await pool.query(
          `SELECT * FROM cart WHERE user_id = ?`,
          [userId],
        );

        if (userCartRows.length) {
          const userCart = userCartRows[0];

          const userItems =
            typeof userCart.items === "string"
              ? JSON.parse(userCart.items || "[]")
              : userCart.items || [];

          // Merge items
          const mergedItems = [...userItems];

          for (const guestItem of guestItems) {
            const existingItem = mergedItems.find(
              (item) =>
                Number(item.product_id) === Number(guestItem.product_id),
            );

            if (existingItem) {
              existingItem.quantity =
                Number(existingItem.quantity) + Number(guestItem.quantity);
            } else {
              mergedItems.push(guestItem);
            }
          }

          // Update user cart
          await pool.query(`UPDATE cart SET items = ? WHERE id = ?`, [
            JSON.stringify(mergedItems),
            userCart.id,
          ]);

          // Delete guest cart
          await pool.query(`DELETE FROM cart WHERE id = ?`, [guestCart.id]);
        } else {
          // No user cart exists, convert guest cart into user cart
          await pool.query(
            `UPDATE cart
         SET user_id = ?, session_token = NULL
         WHERE id = ?`,
            [userId, guestCart.id],
          );
        }
      }
    }

    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: existingUser.id,
        email: existingUser.email,
        full_name: existingUser.full_name,
        email: existingUser.email,
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
    const { email } = req?.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email  is required",
      });
    }

    const [userRows] = await pool.query(`SELECT * FROM users WHERE email = ?`, [
      email,
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
    const otpExpire = new Date(Date.now() + 1 * 60 * 1000);

    await pool.query(
      `UPDATE users SET otp = ?, otp_expire = ? WHERE email = ?`,
      [otp, otpExpire, email],
    );

    // Fetch updated user to return
    const [updatedRows] = await pool.query(
      `SELECT * FROM users WHERE email = ?`,
      [email],
    );
    // Send OTP email
    res.status(201).json({
      message: `OTP resent successfully to ${email}`,
      success: true,
      data: updatedRows[0],
    });
    await sendOTPEmail(email, otp);
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const verifyOTP = async (req, res) => {
  try {
    console.log(req?.body);
    const { email, otp } = req?.body;

    if (!email || !otp) {
      return res.status(400).json({
        message: "All fields are required",
        success: false,
      });
    }

    const [userRows] = await pool.query(`SELECT * FROM users WHERE email = ?`, [
      email,
    ]);

    if (userRows.length <= 0) {
      return res.status(400).json({
        message: "User not found with this email",
        success: false,
      });
    }

    const existingUser = userRows[0];

    console.log(`existingUser`);
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
   WHERE email = ?`,
      [email],
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

export const forgetPassword = async (req, res) => {
  try {
    const { email, otp, password, confirmPassword } = req?.body;

    if (!email || !otp || !password || !confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "All fields are required",
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match",
      });
    }

    const [userRows] = await pool.query(`SELECT * FROM users WHERE email = ?`, [
      email,
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

    await pool.query(`UPDATE users SET password = ? WHERE email = ?`, [
      password,
      email,
    ]);

    // Fetch updated user
    const [updatedRows] = await pool.query(
      `SELECT * FROM users WHERE email = ?`,
      [email],
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
    // const profile_image = req.file?.path;
    // const profile_image_id = req.file?.filename;
    const profile_image = req.file
      ? `${req.protocol}://${req.get("host")}/uploads/profile_images/${req.file.filename}`
      : null;

    if (!profile_image) {
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
    if (existingUser.profile_image) {
      // await cloudinary.uploader.destroy(existingUser.profile_image_id);
      await deleteImage(existingUser.profile_image);
    }

    await pool.query(`UPDATE users SET profile_image = ? WHERE id = ?`, [
      profile_image,
      userId,
    ]);

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
