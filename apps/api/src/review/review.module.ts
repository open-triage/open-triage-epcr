import { Module } from "@nestjs/common";
import { SessionsModule } from "../sessions/sessions.module.js";
import { ReviewController } from "./review.controller.js";
import { ReviewService } from "./review.service.js";

@Module({ imports: [SessionsModule], controllers: [ReviewController], providers: [ReviewService] })
export class ReviewModule {}
