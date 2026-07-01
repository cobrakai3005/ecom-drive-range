import express from "express";
import {
  getCart,
  addToCart,
  updateCartItem,
  removeCartItem,
  clearCart,
} from "../controllers/cart.controller.js";
import verifyToken from "../middlewares/auth.middleware.js"; // optional – use if you want logged-in users
import {
  authenticateAndHandleGuests,
  authorize,
} from "../middlewares/authorize.middleware.js";

const router = express.Router();

router.get("/", authenticateAndHandleGuests, getCart); // authenticate may be optional, but we'll pass userId if present
router.post("/add", authenticateAndHandleGuests, addToCart);
router.put("/item/:productId", authenticateAndHandleGuests, updateCartItem);
router.delete("/item/:productId", authenticateAndHandleGuests, removeCartItem);
router.delete("/clear", authenticateAndHandleGuests, clearCart);

export default router;
