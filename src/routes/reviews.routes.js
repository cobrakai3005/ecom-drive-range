import express from "express";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";
import {
  addReview,
  moderateReview,
  getProductReviews,
  getAllReviews,
  deleteReview,
  updateReview,
  getMyReviews,
  toggleReviewFrontStatus,
  deleteReviewImages,
  getFeaturedReviews,
} from "../controllers/reviews.controller.js";
import upload from "../middlewares/multer.middleware.js";

const router = express.Router();

router.post(
  "/add",
  verifyToken,
  authorize("Customer"),
  (req, res, next) => {
    upload.array("review_images", 5)(req, res, (err) => {
      if (err) {
        // Multer error (file size, type, etc.)
        return res.status(400).json({ message: err.message });
      }
      next();
    });
  },
  addReview,
);
router.put(
  "/update/:id",
  verifyToken,
  authorize("Customer"),
  (req, res, next) => {
    upload.array("review_images", 5)(req, res, (err) => {
      if (err) {
        // Multer error (file size, type, etc.)
        return res.status(400).json({ message: err.message });
      }
      next();
    });
  },
  updateReview,
);

router.get("/product/:productId", getProductReviews); // public
router.get("/my-reviews", verifyToken, authorize("Customer"), getMyReviews);
router.get(
  "/admin/all",
  verifyToken,
  authorize("Admin", "Staff"),
  getAllReviews,
);
router.get("/get_featured_reviews", getFeaturedReviews);
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
router.delete(
  "/admin/:id/delete_images",
  verifyToken,
  authorize("Admin", "Staff", "Customer"),
  deleteReviewImages,
);
router.patch(
  "/admin/:id/toggle_is_front",
  verifyToken,
  authorize("Admin", "Staff", "Customer"),
  toggleReviewFrontStatus,
);

export default router;
