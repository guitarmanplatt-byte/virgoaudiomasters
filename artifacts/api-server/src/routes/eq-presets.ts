import { Router, type IRouter } from "express";
import { EQ_PRESETS } from "../lib/static-data";

const router: IRouter = Router();

router.get("/eq-presets", async (_req, res): Promise<void> => {
  res.json(EQ_PRESETS);
});

export default router;
