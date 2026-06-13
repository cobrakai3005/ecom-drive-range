import express from "express";
import { createGuestToken } from "../controllers/guest_token.controller.js";
const router = express.Router();

router.post("/", createGuestToken);

export default router;
