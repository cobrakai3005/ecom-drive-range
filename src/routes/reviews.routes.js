import express from "express";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";
import {
  addReview,
  moderateReview,
  getProductReviews,
  getAllReviews,
  deleteReview,
} from "../controllers/reviews.controller.js";

const router = express.Router();

router.post("/add", verifyToken, authorize("Customer"), addReview);
router.get("/product/:productId", getProductReviews); // public
router.get(
  "/admin/all",
  verifyToken,
  authorize("Admin", "Staff"),
  getAllReviews,
);
router.put(
  "/admin/:id/moderate",
  verifyToken,
  authorize("Admin", "Staff"),
  moderateReview,
);
router.delete(
  "/admin/:id/delete",
  verifyToken,
  authorize("Admin", "Staff", "Customer"),
  deleteReview,
);

export default router;
