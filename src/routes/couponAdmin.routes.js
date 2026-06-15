// routes/admin/couponAdmin.routes.js
import express from "express";
import {
  createCouponTemplate,
  getAllCouponTemplates,
  getUserCouponsAdmin,
  getUserCoupons,
  applyCoupon,
} from "../controllers/coupon.controller.js";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";

const router = express.Router();

// All routes require Admin
// ADmin

router.post(
  "/create-template",
  verifyToken,
  authorize("Admin"),
  createCouponTemplate,
);

router.get(
  "/templates",
  verifyToken,
  authorize("Admin"),
  getAllCouponTemplates,
);
router.get(
  "/user-coupons/:userId",
  verifyToken,
  authorize("Admin"),
  getUserCouponsAdmin,
);

router.get("/my-coupons", verifyToken, getUserCoupons);
router.post("/apply", verifyToken, applyCoupon);

export default router;
