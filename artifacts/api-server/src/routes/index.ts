import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import gamesRouter from "./games";
import oddsRouter from "./odds";
import predictionsRouter from "./predictions";
import betsRouter from "./bets";
import dashboardRouter from "./dashboard";
import alertsRouter from "./alerts";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(gamesRouter);
router.use(oddsRouter);
router.use(predictionsRouter);
router.use(betsRouter);
router.use(dashboardRouter);
router.use(alertsRouter);

export default router;
