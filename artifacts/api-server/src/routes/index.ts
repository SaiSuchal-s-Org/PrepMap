import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import configsRouter from "./configs";
import nodesRouter from "./nodes";
import subtopicsRouter from "./subtopics";
import eventsRouter from "./events";
import adminRouter from "./admin";
import generationRouter from "./generation";
import storageRouter from "./storage";
import metadataRouter from "./metadata";
import libraryRouter from "./library";
import quickPracticeRouter from "./quickPractice";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(configsRouter);
router.use(nodesRouter);
router.use(subtopicsRouter);
router.use(eventsRouter);
router.use(adminRouter);
router.use(generationRouter);
router.use(storageRouter);
router.use(metadataRouter);
router.use(libraryRouter);
router.use(quickPracticeRouter);

export default router;
