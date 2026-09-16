import { Body, Controller, Headers, HttpCode, Post } from "@nestjs/common";
import type { CreateFeedbackResponse } from "@open-triage/contracts";
import { bearerToken } from "../sessions/clinician-session.controller.js";
import { FeedbackService } from "./feedback.service.js";
import { validateCreateFeedback } from "./feedback.validation.js";

@Controller("feedback/v1/submissions")
export class FeedbackController {
  constructor(private readonly feedback: FeedbackService) {}

  @Post()
  @HttpCode(201)
  create(
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string
  ): Promise<CreateFeedbackResponse> {
    return this.feedback.create(bearerToken(authorization, cookie), validateCreateFeedback(body));
  }
}
