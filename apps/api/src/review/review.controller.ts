import { BadRequestException, Body, ConflictException, Controller, Get, Header, Headers, NotFoundException, Param, ParseUUIDPipe, Post, Query, Res } from "@nestjs/common";
import type { AssignReviewItemCommand, ClaimReviewItemCommand, ConfigureReviewRouteCommand, ReviewCriterionRoute, ReviewEligibleReviewer, ReviewItemDetail, ReviewProgressCommand, ReviewOutcomeCommand, ReviewOutcomeOption, ReviewSignedReport, ReviewSignedReportsResponse, ReviewVolumeResult, ReviewAnalysisDefinition, ReviewAnalysisField, ReviewAnalysisResult, ReviewRetrospectiveDefinition, ReviewRetrospectivePreview, ReviewRetrospectiveRun, ReviewRetrospectiveVersion, StartReviewRetrospectiveCommand, ConfigureReviewAmendmentPolicyCommand, ReviewAmendmentPolicy } from "@open-triage/contracts";
import { bearerToken } from "../sessions/clinician-session.controller.js";
import { ReviewService } from "./review.service.js";
import { aggregateRevision, analysisCsv, volumeCsv } from "./review-csv.js";

type CsvResponse = { setHeader(name: string, value: string): unknown; send(body: string): unknown };

function expectedRevision(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value))
    throw new BadRequestException("Invalid Review export revision");
  return value;
}

function sendCsv(response: CsvResponse, filename: string, value: string) {
  response.setHeader("Content-Type", "text/csv; charset=utf-8");
  response.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  response.setHeader("Content-Length", String(Buffer.byteLength(value, "utf8")));
  response.setHeader("Cache-Control", "no-store, private");
  response.setHeader("Pragma", "no-cache");
  return response.send(value);
}

@Controller("review")
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @Get("overdue-policy")
  @Header("Cache-Control", "no-store, private")
  overduePolicy(@Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string) {
    return this.review.overduePolicy(bearerToken(authorization, cookie));
  }

  @Post("overdue-policy")
  @Header("Cache-Control", "no-store, private")
  configureOverduePolicy(@Body() command: { commandId: string; expectedVersion: number;
    deadlineHours: number }, @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string, @Headers("x-csrf-token") csrfToken?: string) {
    return this.review.configureOverduePolicy(bearerToken(authorization, cookie), command, csrfToken);
  }

  @Get("retrospective/versions")
  @Header("Cache-Control", "no-store, private")
  retrospectiveVersions(@Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string): Promise<ReviewRetrospectiveVersion[]> {
    return this.review.retrospectiveVersions(bearerToken(authorization, cookie));
  }

  @Post("retrospective/preview")
  @Header("Cache-Control", "no-store, private")
  retrospectivePreview(@Body() definition: ReviewRetrospectiveDefinition,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string): Promise<ReviewRetrospectivePreview> {
    return this.review.retrospectivePreview(bearerToken(authorization, cookie), definition);
  }

  @Get("retrospective/runs")
  @Header("Cache-Control", "no-store, private")
  retrospectiveRuns(@Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string): Promise<ReviewRetrospectiveRun[]> {
    return this.review.retrospectiveRuns(bearerToken(authorization, cookie));
  }

  @Post("retrospective/runs")
  @Header("Cache-Control", "no-store, private")
  startRetrospective(@Body() command: StartReviewRetrospectiveCommand,
    @Headers("authorization") authorization?: string, @Headers("cookie") cookie?: string,
    @Headers("x-csrf-token") csrfToken?: string): Promise<ReviewRetrospectiveRun> {
    return this.review.startRetrospective(bearerToken(authorization, cookie), command, csrfToken);
  }

  @Get("retrospective/runs/:id")
  @Header("Cache-Control", "no-store, private")
  retrospectiveRun(@Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string): Promise<ReviewRetrospectiveRun> {
    return this.review.retrospectiveRun(bearerToken(authorization, cookie), id);
  }

  @Post("retrospective/runs/:id/advance")
  @Header("Cache-Control", "no-store, private")
  advanceRetrospective(@Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Body() body: { batchSize?: number }, @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string,
    @Headers("x-csrf-token") csrfToken?: string): Promise<ReviewRetrospectiveRun> {
    return this.review.advanceRetrospective(bearerToken(authorization, cookie), id, body?.batchSize ?? 25, csrfToken);
  }

  @Get("amendment-policy")
  @Header("Cache-Control", "no-store, private")
  amendmentPolicy(@Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string): Promise<ReviewAmendmentPolicy> {
    return this.review.amendmentPolicy(bearerToken(authorization, cookie));
  }

  @Post("amendment-policy")
  @Header("Cache-Control", "no-store, private")
  configureAmendmentPolicy(@Body() command: ConfigureReviewAmendmentPolicyCommand,
    @Headers("authorization") authorization?: string, @Headers("cookie") cookie?: string,
    @Headers("x-csrf-token") csrfToken?: string): Promise<ReviewAmendmentPolicy> {
    return this.review.configureAmendmentPolicy(bearerToken(authorization, cookie), command, csrfToken);
  }

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
  async analysis(@Body() definition: ReviewAnalysisDefinition,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string): Promise<ReviewAnalysisResult> {
    const result = await this.review.analysis(bearerToken(authorization, cookie), definition);
    return { ...result, exportRevision: aggregateRevision(result) };
  }

  @Post("analysis/export")
  async exportAnalysis(@Body() request: { definition: ReviewAnalysisDefinition; expectedRevision: string },
    @Headers("authorization") authorization: string | undefined,
    @Headers("cookie") cookie: string | undefined,
    @Res() response: CsvResponse) {
    const revision = expectedRevision(request?.expectedRevision);
    const result = await this.review.analysis(bearerToken(authorization, cookie), request?.definition);
    const current = aggregateRevision(result);
    if (result.freshness.status !== "current" || current !== revision)
      throw new ConflictException({ message: "Review aggregate changed; refresh before exporting",
        result: { ...result, exportRevision: current } });
    return sendCsv(response, "review-analysis.csv", analysisCsv(result));
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
  async volume(
    @Query("dataset") dataset?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string,
  ): Promise<ReviewVolumeResult> {
    const result = await this.review.volume(bearerToken(authorization, cookie), dataset, from, to);
    return { ...result, exportRevision: aggregateRevision(result) };
  }

  @Post("volume/export")
  async exportVolume(@Body() request: { definition: ReviewVolumeResult["definition"]; expectedRevision: string },
    @Headers("authorization") authorization: string | undefined,
    @Headers("cookie") cookie: string | undefined,
    @Res() response: CsvResponse) {
    const revision = expectedRevision(request?.expectedRevision);
    const definition = request?.definition;
    if (definition?.measure !== "signed-report-count" || definition?.grouping !== "day")
      throw new BadRequestException("Invalid Review volume definition");
    const result = await this.review.volume(bearerToken(authorization, cookie),
      definition.filters?.dataset, definition.filters?.from, definition.filters?.to);
    const current = aggregateRevision(result);
    if (result.freshness.status !== "current" || current !== revision)
      throw new ConflictException({ message: "Review aggregate changed; refresh before exporting",
        result: { ...result, exportRevision: current } });
    return sendCsv(response, "review-volume.csv", volumeCsv(result));
  }
  @Get("items/:id")
  @Header("Cache-Control", "no-store, private")
  item(@Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Query("dataset") dataset?: string, @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string): Promise<ReviewItemDetail> {
    return this.review.item(bearerToken(authorization, cookie), id, dataset);
  }

  @Get("items/:id/draft")
  @Header("Cache-Control", "no-store, private")
  overdueDraft(@Param("id", new ParseUUIDPipe({ version: "4" })) id: string,
    @Query("dataset") dataset?: string, @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string) {
    return this.review.overdueDraft(bearerToken(authorization, cookie), id, dataset);
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
