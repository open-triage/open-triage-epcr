import { Body, Controller, Get, Header, Headers, NotFoundException, Param, ParseUUIDPipe, Post, Query, Res } from "@nestjs/common";
import type { AssignReviewItemCommand, ClaimReviewItemCommand, ConfigureReviewRouteCommand, ReviewCriterionRoute, ReviewEligibleReviewer, ReviewItemDetail, ReviewProgressCommand, ReviewOutcomeCommand, ReviewOutcomeOption, ReviewSignedReport, ReviewSignedReportsResponse, ReviewVolumeResult, ReviewAnalysisDefinition, ReviewAnalysisField, ReviewAnalysisResult } from "@open-triage/contracts";
import { bearerToken } from "../sessions/clinician-session.controller.js";
import { ReviewService } from "./review.service.js";

@Controller("review")
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @Get("routes")
  @Header("Cache-Control", "no-store, private")
  routes(@Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string): Promise<ReviewCriterionRoute[]> {
    return this.review.routes(bearerToken(authorization, cookie));
  }

  @Post("routes/:criterionId")
  @Header("Cache-Control", "no-store, private")
  configureRoute(@Param("criterionId", new ParseUUIDPipe({ version: "4" })) criterionId: string,
    @Body() command: ConfigureReviewRouteCommand, @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string, @Headers("x-csrf-token") csrfToken?: string): Promise<ReviewCriterionRoute> {
    return this.review.configureRoute(bearerToken(authorization, cookie), criterionId, command, csrfToken);
  }

  @Get("eligible-reviewers")
  @Header("Cache-Control", "no-store, private")
  reviewers(@Query("itemId") itemId?: string, @Query("dataset") dataset?: string,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string): Promise<ReviewEligibleReviewer[]> {
    return this.review.reviewers(bearerToken(authorization, cookie), itemId, dataset);
  }

  @Get("queue")
  @Header("Cache-Control", "no-store, private")
  queue(@Query() filters: { dataset?: string; criterion?: string; priority?: string; status?: string;
      from?: string; to?: string; page?: string; pageSize?: string },
    @Headers("authorization") authorization?: string, @Headers("cookie") cookie?: string) {
    return this.review.queue(bearerToken(authorization, cookie), filters);
  }

  @Get("backlog")
  @Header("Cache-Control", "no-store, private")
  backlog(@Query("dataset") dataset?: string, @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string) {
    return this.review.backlog(bearerToken(authorization, cookie), dataset);
  }

  @Get("analysis/fields")
  @Header("Cache-Control", "no-store, private")
  fields(@Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string): Promise<ReviewAnalysisField[]> {
    return this.review.analysisFields(bearerToken(authorization, cookie));
  }

  @Post("analysis")
  @Header("Cache-Control", "no-store, private")
  analysis(@Body() definition: ReviewAnalysisDefinition,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string): Promise<ReviewAnalysisResult> {
    return this.review.analysis(bearerToken(authorization, cookie), definition);
  }

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


  @Get("reports/:id")
  @Header("Cache-Control", "no-store, private")
  report(@Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Query("dataset") dataset?: string, @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string): Promise<ReviewSignedReport> {
    return this.review.report(bearerToken(authorization, cookie), id, dataset);
  }

  @Get("reports/:id/:type/:noteId/content")
  async media(@Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Param("type") type: string, @Param("noteId", new ParseUUIDPipe({ version: "4" })) noteId: string,
    @Query("dataset") dataset: string | undefined,
    @Headers("authorization") authorization: string | undefined, @Headers("cookie") cookie: string | undefined,
    @Res() response: { setHeader(name: string, value: string): unknown; send(body: Buffer): unknown }) {
    if (type !== "photo" && type !== "audio") throw new NotFoundException();
    const media = await this.review.media(bearerToken(authorization, cookie), id, noteId, type, dataset);
    response.setHeader("Content-Type", media.contentType);
    response.setHeader("Content-Length", String(media.bytes.byteLength));
    response.setHeader("Content-Disposition", `inline; filename="review-${noteId}.${type === "photo" ? "jpg" : "m4a"}"`);
    response.setHeader("Cache-Control", "no-store, private");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("ETag", `"sha256-${media.sha256}"`);
    return response.send(media.bytes);
  }

  @Get("volume")
  @Header("Cache-Control", "no-store, private")
  volume(
    @Query("dataset") dataset?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string,
  ): Promise<ReviewVolumeResult> {
    return this.review.volume(bearerToken(authorization, cookie), dataset, from, to);
  }
  @Get("items/:id")
  @Header("Cache-Control", "no-store, private")
  item(@Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Query("dataset") dataset?: string, @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string): Promise<ReviewItemDetail> {
    return this.review.item(bearerToken(authorization, cookie), id, dataset);
  }

  @Post("items/:id/claim")
  @Header("Cache-Control", "no-store, private")
  claim(@Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() command: ClaimReviewItemCommand, @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string, @Headers("x-csrf-token") csrfToken?: string): Promise<ReviewItemDetail> {
    return this.review.claim(bearerToken(authorization, cookie), id, command, csrfToken);
  }

  @Post("items/:id/assign")
  @Header("Cache-Control", "no-store, private")
  assign(@Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() command: AssignReviewItemCommand, @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string, @Headers("x-csrf-token") csrfToken?: string): Promise<ReviewItemDetail> {
    return this.review.assign(bearerToken(authorization, cookie), id, command, csrfToken);
  }
  @Post("items/:id/progress")
  @Header("Cache-Control", "no-store, private")
  progress(@Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() command: ReviewProgressCommand, @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string, @Headers("x-csrf-token") csrfToken?: string): Promise<ReviewItemDetail> {
    return this.review.progress(bearerToken(authorization, cookie), id, command, csrfToken);
  }

  @Get("outcomes")
  @Header("Cache-Control", "no-store, private")
  outcomes(@Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string): Promise<ReviewOutcomeOption[]> {
    return this.review.outcomes(bearerToken(authorization, cookie));
  }

  @Post("outcomes")
  @Header("Cache-Control", "no-store, private")
  configureOutcome(@Body() command: ReviewOutcomeCommand,
    @Headers("authorization") authorization?: string, @Headers("cookie") cookie?: string,
    @Headers("x-csrf-token") csrfToken?: string): Promise<ReviewOutcomeOption> {
    return this.review.configureOutcome(bearerToken(authorization, cookie), command, csrfToken);
  }
}
