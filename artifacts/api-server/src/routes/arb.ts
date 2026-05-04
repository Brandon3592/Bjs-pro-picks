import { Router } from "express";
import { fetchAllSportOdds } from "../lib/odds-api";
import { findArbOpportunities } from "../lib/arb";

const router = Router();

router.get("/arb", async (req, res) => {
  try {
    const allOdds = await fetchAllSportOdds();
    const opportunities = findArbOpportunities(allOdds);
    return res.json(opportunities);
  } catch (err) {
    req.log.error({ err }, "Error finding arb opportunities");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
