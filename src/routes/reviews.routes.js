import express from "express";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";
import {
  addReview,
  moderateReview,
  getProductReviews,
  getAllReviews,
} from "../controllers/reviews.controller.js";

const router = express.Router();

router.post("/add", verifyToken, authorize("Customer"), addReview);
router.get("/product/:productItemId", getProductReviews); // public
router.get("/admin/all", verifyToken, authorize("Admin", "Staff"), getAllReviews);
router.put("/admin/:id/moderate", verifyToken, authorize("Admin", "Staff"), moderateReview);

export default router;