import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import gamesRouter from "./games";
import oddsRouter from "./odds";
import betsRouter from "./bets";
import dashboardRouter from "./dashboard";
import alertsRouter from "./alerts";
import lineMovementsRouter from "./line-movements";
import arbRouter from "./arb";
import propsRouter from "./props";
import allMarketsRouter from "./all-markets";
import aiPicksRouter from "./ai-picks";

const router: IRouter = Router();

router.use(aiPicksRouter);
router.use(healthRouter);
router.use(authRouter);
router.use(gamesRouter);
router.use(oddsRouter);
router.use(betsRouter);
router.use(dashboardRouter);
router.use(alertsRouter);
router.use(lineMovementsRouter);
router.use(arbRouter);
router.use(propsRouter);
router.use(allMarketsRouter);

export default router;
