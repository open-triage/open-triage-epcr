import { Module } from "@nestjs/common";
import { SessionsModule } from "../sessions/sessions.module.js";
import { ReviewController } from "./review.controller.js";
import { AnalyticsController } from "./analytics.controller.js";
import { AnalyticsService } from "./analytics.service.js";
import { ReviewService } from "./review.service.js";

@Module({ imports: [SessionsModule], controllers: [ReviewController, AnalyticsController], providers: [ReviewService, AnalyticsService] })
export class ReviewModule {}
