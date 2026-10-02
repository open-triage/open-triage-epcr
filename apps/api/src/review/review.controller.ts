import { Controller, Get, Header, Headers, NotFoundException, Param, ParseUUIDPipe, Query, Res } from "@nestjs/common";
import type { ReviewSignedReport, ReviewSignedReportsResponse, ReviewVolumeResult } from "@open-triage/contracts";
import { bearerToken } from "../sessions/clinician-session.controller.js";
import { ReviewService } from "./review.service.js";

@Controller("review")
export class ReviewController {
  constructor(private readonly review: ReviewService) {}


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
}
