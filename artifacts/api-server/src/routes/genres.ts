import { Router, type IRouter } from "express";
import { MASTERING_GENRES } from "../lib/static-data";

const router: IRouter = Router();

router.get("/genres", async (_req, res): Promise<void> => {
  res.json(MASTERING_GENRES);
});

export default router;
