import express from "express";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";
import {
  addWebsiteReview,
  deleteWebsiteReview,
  getAllWebsiteReviews,
  getWebsiteReviews,
  moderateWebsiteReview,
} from "../controllers/website_reviews.controller.js";
const router = express.Router();

router.post("/add", verifyToken, authorize("Customer"), addWebsiteReview);


router.delete(
  "/delete/:id",
  verifyToken,
  authorize("Customer","Admin", "Staff"),
  deleteWebsiteReview,
);

// Public
router.get("/", getWebsiteReviews);

// Admin / Staff
router.get(
  "/admin/all",
  verifyToken,
  authorize("Admin", "Staff"),
  getAllWebsiteReviews,
);

router.patch(
  "/admin/moderate/:id",
  verifyToken,
  authorize("Admin", "Staff"),
  moderateWebsiteReview,
);

export default router;
