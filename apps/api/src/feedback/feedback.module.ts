import { Module } from "@nestjs/common";
import { SessionsModule } from "../sessions/sessions.module.js";
import { FeedbackController } from "./feedback.controller.js";
import { FeedbackService } from "./feedback.service.js";

@Module({
  imports: [SessionsModule],
  controllers: [FeedbackController],
  providers: [FeedbackService]
})
export class FeedbackModule {}
