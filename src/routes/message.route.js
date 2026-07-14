import express from "express";
import {
  createMessage,
  getAllMessages,
  getMessageById,
  updateMessage,
  deleteMessage,
} from "../controllers/message.controller.js";
import verifyToken from "../middlewares/auth.middleware.js";
import { authorize } from "../middlewares/authorize.middleware.js";

const router = express.Router();

router.post("/", createMessage);
router.get("/", verifyToken, authorize("Admin", "Staff"), getAllMessages);
router.get("/:id", verifyToken, authorize("Admin", "Staff"), getMessageById);
router.put("/:id", verifyToken, authorize("Admin", "Staff"), updateMessage);
router.delete("/:id", verifyToken, authorize("Admin", "Staff"), deleteMessage);

export default router;
