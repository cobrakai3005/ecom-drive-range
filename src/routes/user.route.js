import express from "express";
import { deactivateUser, getUsers } from "../controllers/user.controller.js";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";
const router = express.Router();

router.get("/get-users", verifyToken, authorize("Admin"), getUsers);
router.patch(
  "/deactivate-user/:id",
  verifyToken,
  authorize("Admin"),
  deactivateUser,
);

export default router;
