import { Controller, Get, Header, Headers, Query } from "@nestjs/common";
import type { ReviewSignedReportsResponse } from "@open-triage/contracts";
import { bearerToken } from "../sessions/clinician-session.controller.js";
import { ReviewService } from "./review.service.js";

@Controller("review")
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @Get("reports")
  @Header("Cache-Control", "no-store, private")
  reports(
    @Query("dataset") dataset?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string,
  ): Promise<ReviewSignedReportsResponse> {
    return this.review.signedReports(bearerToken(authorization, cookie), dataset, page, pageSize);
  }
}
