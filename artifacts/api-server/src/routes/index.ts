import { Router, type IRouter } from "express";
import healthRouter from "./health";
import audioRouter from "./audio";
import eqPresetsRouter from "./eq-presets";
import genresRouter from "./genres";
import pluginPresetsRouter from "./plugin-presets";

const router: IRouter = Router();

router.use(healthRouter);
router.use(audioRouter);
router.use(eqPresetsRouter);
router.use(genresRouter);
router.use(pluginPresetsRouter);

export default router;
