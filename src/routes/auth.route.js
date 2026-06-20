import express from "express";
import {
  testController,
  registerController as register,
  login,
  logout,
  resendOtp,
  verifyOTP,
  updateProfileImage,
  forgetPassword,
} from "../controllers/auth.controller.js";
import upload from "../middlewares/multer.middleware.js";
import verifyToken from "../middlewares/auth.middleware.js";

const router = express.Router();

router.post("/login", login);
router.post("/register", upload.single("profile_image"), register);
router.post("/logout", verifyToken, logout);
router.post("/verify-otp", verifyOTP);
router.post("/resend", resendOtp);
router.post("/forget-password", verifyToken, forgetPassword);
router.patch(
  "/update-profile-image",
  verifyToken,
  upload.single("profile_image"),
  updateProfileImage,
);

export default router;
