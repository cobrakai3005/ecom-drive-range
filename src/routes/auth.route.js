import express from "express";
import {
  registerController as register,
  login,
  logout,
  resendOtp,
  verifyOTP,
  updateProfileImage,
  forgetPassword,
  getMe,
} from "../controllers/auth.controller.js";
// import upload from "../middlewares/multer.middleware.js";
import verifyToken from "../middlewares/auth.middleware.js";
import createUpload from "../middlewares/multer.middleware.js";
const router = express.Router();
const upload = createUpload("profile_images");
router.get("/me", verifyToken, getMe);
router.post("/login", login);
router.post(
  "/register",
  (req, res, next) => {
    upload.single("profile_image")(req, res, (err) => {
      if (err) {
        // Multer error (file size, type, etc.)
        return res.status(400).json({ message: err.message });
      }
      next();
    });
  },
  register,
);
router.post("/logout", verifyToken, logout);
router.post("/verify-otp", verifyOTP);
router.post("/resend", resendOtp);
router.post("/forget-password", forgetPassword);
router.patch(
  "/update-profile-image",
  verifyToken,

  (req, res, next) => {
    upload.single("profile_image")(req, res, (err) => {
      if (err) {
        // Multer error (file size, type, etc.)
        return res.status(400).json({ message: err.message });
      }
      next();
    });
  },
  updateProfileImage,
);

export default router;
