import { Body, Controller, Delete, Get, Header, Headers, HttpCode, Param, ParseUUIDPipe, Post, Res } from "@nestjs/common";
import type { ActiveReportResource, DeleteDraftReportResponse, DispatchConflict, OpenCallsResponse,
  ProtectedCiphertextReceipt, ProtectedReportCheckpoint, ProtectedReportKeyEnvelope,
  ProtectedReportRecoveryGrant, RecoveredProtectedReportKey, ReopenOpenCallResponse,
  ValidationReviewEvaluation } from "@open-triage/contracts";
import { bearerToken } from "../sessions/clinician-session.controller.js";
import { DraftReportService } from "./draft-report.service.js";
import type { DraftReportResult, SaveDraftReportResult } from "./draft-report.types.js";
import { SignReportService } from "./sign-report.service.js";
import type { SignedReportResult } from "./sign-report.types.js";
import { ProtectedReportKeyService } from "./protected-report-key.service.js";
import { ReviewValidationService } from "./review-validation.service.js";
import { ReportNoteService } from "./report-note.service.js";
import { ReportPhotoService } from "./report-photo.service.js";
import { ReportAudioService } from "./report-audio.service.js";

const uuidV4 = new ParseUUIDPipe({ version: "4" });
type ConditionalResponse = { setHeader(name: string, value: string): unknown; status(code: number): unknown };
type BinaryResponse = { setHeader(name: string, value: string): unknown; send(body: Buffer): unknown };

@Controller("reports")
export class DraftReportController {
  constructor(
    private readonly reports: DraftReportService,
    private readonly signing: SignReportService,
    private readonly protectedKeys: ProtectedReportKeyService,
    private readonly reviewValidation: ReviewValidationService,
    private readonly reportNotes: ReportNoteService,
    private readonly reportPhotos: ReportPhotoService,
    private readonly reportAudio: ReportAudioService,
  ) {}

  @Post()
  @Header("Cache-Control", "no-store, private")
  create(@Body() body: unknown, @Headers("authorization") authorization?: string, @Headers("cookie") cookie?: string): Promise<DraftReportResult> {
    return this.reports.create(bearerToken(authorization, cookie), body);
  }

  @Post(":id/protected-key-envelope")
  @HttpCode(201)
  @Header("Cache-Control", "no-store, private")
  registerProtectedKey(
    @Param("id", uuidV4) id: string,
    @Body() body: unknown,
    @Headers("x-csrf-token") csrfToken?: string,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string,
  ): Promise<ProtectedReportKeyEnvelope> {
    return this.protectedKeys.register(bearerToken(authorization, cookie), id, body, csrfToken);
  }

  @Post(":id/protected-ciphertext-checkpoint")
  @HttpCode(200)
  @Header("Cache-Control", "no-store, private")
  checkpointProtectedCiphertext(
    @Param("id", uuidV4) id: string,
    @Body() body: unknown,
    @Headers("x-csrf-token") csrfToken?: string,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string,
  ): Promise<ProtectedReportCheckpoint> {
    return this.protectedKeys.checkpoint(bearerToken(authorization, cookie), id, body, csrfToken);
  }

  @Post(":id/protected-ciphertext-receipt")
  @HttpCode(200)
  @Header("Cache-Control", "no-store, private")
  recordProtectedCiphertext(
    @Param("id", uuidV4) id: string,
    @Body() body: unknown,
    @Headers("x-csrf-token") csrfToken?: string,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string,
  ): Promise<ProtectedCiphertextReceipt> {
    return this.protectedKeys.recordWrite(bearerToken(authorization, cookie), id, body, csrfToken);
  }

  @Post(":id/recovery-grants")
  @HttpCode(201)
  @Header("Cache-Control", "no-store, private")
  @Header("Pragma", "no-cache")
  createRecoveryGrant(
    @Param("id", uuidV4) id: string,
    @Body() body: unknown,
    @Headers("x-csrf-token") csrfToken?: string,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string,
  ): Promise<ProtectedReportRecoveryGrant> {
    return this.protectedKeys.createRecoveryGrant(bearerToken(authorization, cookie), id, body, csrfToken);
  }

  @Post(":id/recovery-grants/consume")
  @HttpCode(200)
  @Header("Cache-Control", "no-store, private")
  @Header("Pragma", "no-cache")
  consumeRecoveryGrant(
    @Param("id", uuidV4) id: string,
    @Body() body: unknown,
    @Headers("x-csrf-token") csrfToken?: string,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string,
  ): Promise<RecoveredProtectedReportKey> {
    return this.protectedKeys.consumeRecoveryGrant(bearerToken(authorization, cookie), id, body, csrfToken);
  }

  @Get("open")
  @Header("Cache-Control", "no-store, private")
  listOpen(@Headers("authorization") authorization?: string, @Headers("cookie") cookie?: string): Promise<OpenCallsResponse> {
    return this.reports.listOpen(bearerToken(authorization, cookie));
  }

  @Post(":id/draft-changes")
  @Header("Cache-Control", "no-store, private")
  save(
    @Param("id", uuidV4) id: string,
    @Body() body: unknown,
    @Headers("x-csrf-token") csrfToken?: string,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string
  ): Promise<SaveDraftReportResult> {
    return this.reports.save(bearerToken(authorization, cookie), id, body, csrfToken);
  }

  @Post(":id/notes")
  @HttpCode(201)
  @Header("Cache-Control", "no-store, private")
  createTextNote(
    @Param("id", uuidV4) id: string,
    @Body() body: unknown,
    @Headers("x-csrf-token") csrfToken?: string,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string,
  ) {
    return this.reportNotes.create(bearerToken(authorization, cookie), id, body, csrfToken);
  }

  @Post(":id/notes/:noteId")
  @HttpCode(200)
  @Header("Cache-Control", "no-store, private")
  updateTextNote(
    @Param("id", uuidV4) id: string,
    @Param("noteId", uuidV4) noteId: string,
    @Body() body: unknown,
    @Headers("x-csrf-token") csrfToken?: string,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string,
  ) {
    return this.reportNotes.update(bearerToken(authorization, cookie), id, noteId, body, csrfToken);
  }

  @Delete(":id/notes/:noteId")
  @Header("Cache-Control", "no-store, private")
  deleteTextNote(
    @Param("id", uuidV4) id: string,
    @Param("noteId", uuidV4) noteId: string,
    @Body() body: unknown,
    @Headers("x-csrf-token") csrfToken?: string,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string,
  ) {
    return this.reportNotes.delete(bearerToken(authorization, cookie), id, noteId, body, csrfToken);
  }

  @Post(":id/photos")
  @HttpCode(201)
  @Header("Cache-Control", "no-store, private")
  createPhotoNote(
    @Param("id", uuidV4) id: string, @Body() body: unknown,
    @Headers("x-csrf-token") csrfToken?: string,
    @Headers("authorization") authorization?: string, @Headers("cookie") cookie?: string,
  ) {
    return this.reportPhotos.create(bearerToken(authorization, cookie), id, body, csrfToken);
  }

  @Post(":id/photos/:noteId")
  @HttpCode(200)
  @Header("Cache-Control", "no-store, private")
  updatePhotoCaption(
    @Param("id", uuidV4) id: string, @Param("noteId", uuidV4) noteId: string, @Body() body: unknown,
    @Headers("x-csrf-token") csrfToken?: string,
    @Headers("authorization") authorization?: string, @Headers("cookie") cookie?: string,
  ) {
    return this.reportPhotos.updateCaption(bearerToken(authorization, cookie), id, noteId, body, csrfToken);
  }

  @Delete(":id/photos/:noteId")
  @Header("Cache-Control", "no-store, private")
  deletePhotoNote(
    @Param("id", uuidV4) id: string, @Param("noteId", uuidV4) noteId: string, @Body() body: unknown,
    @Headers("x-csrf-token") csrfToken?: string,
    @Headers("authorization") authorization?: string, @Headers("cookie") cookie?: string,
  ) {
    return this.reportPhotos.delete(bearerToken(authorization, cookie), id, noteId, body, csrfToken);
  }

  @Get(":id/photos/:noteId/image")
  async photoImage(
    @Param("id", uuidV4) id: string, @Param("noteId", uuidV4) noteId: string,
    @Headers("authorization") authorization: string | undefined, @Headers("cookie") cookie: string | undefined,
    @Res() response: BinaryResponse,
  ) {
    const image = await this.reportPhotos.image(bearerToken(authorization, cookie), id, noteId);
    response.setHeader("Content-Type", image.contentType);
    response.setHeader("Content-Length", String(image.bytes.byteLength));
    response.setHeader("Content-Disposition", `inline; filename="photo-${noteId}.jpg"`);
    response.setHeader("Cache-Control", "no-store, private");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("ETag", `"sha256-${image.sha256}"`);
    return response.send(image.bytes);
  }

  @Post(":id/audio")
  @HttpCode(201)
  @Header("Cache-Control", "no-store, private")
  createAudioNote(
    @Param("id", uuidV4) id: string, @Body() body: unknown,
    @Headers("x-csrf-token") csrfToken?: string,
    @Headers("authorization") authorization?: string, @Headers("cookie") cookie?: string,
  ) {
    return this.reportAudio.create(bearerToken(authorization, cookie), id, body, csrfToken);
  }

  @Post(":id/audio/:noteId")
  @HttpCode(200)
  @Header("Cache-Control", "no-store, private")
  updateAudioCaption(
    @Param("id", uuidV4) id: string, @Param("noteId", uuidV4) noteId: string, @Body() body: unknown,
    @Headers("x-csrf-token") csrfToken?: string,
    @Headers("authorization") authorization?: string, @Headers("cookie") cookie?: string,
  ) {
    return this.reportAudio.updateCaption(bearerToken(authorization, cookie), id, noteId, body, csrfToken);
  }

  @Delete(":id/audio/:noteId")
  @Header("Cache-Control", "no-store, private")
  deleteAudioNote(
    @Param("id", uuidV4) id: string, @Param("noteId", uuidV4) noteId: string, @Body() body: unknown,
    @Headers("x-csrf-token") csrfToken?: string,
    @Headers("authorization") authorization?: string, @Headers("cookie") cookie?: string,
  ) {
    return this.reportAudio.delete(bearerToken(authorization, cookie), id, noteId, body, csrfToken);
  }

  @Get(":id/audio/:noteId/content")
  async audioContent(
    @Param("id", uuidV4) id: string, @Param("noteId", uuidV4) noteId: string,
    @Headers("authorization") authorization: string | undefined, @Headers("cookie") cookie: string | undefined,
    @Res() response: BinaryResponse,
  ) {
    const audio = await this.reportAudio.audio(bearerToken(authorization, cookie), id, noteId);
    response.setHeader("Content-Type", audio.contentType);
    response.setHeader("Content-Length", String(audio.bytes.byteLength));
    response.setHeader("Content-Disposition", `inline; filename="spoken-note-${noteId}.m4a"`);
    response.setHeader("Cache-Control", "no-store, private");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("ETag", `"sha256-${audio.sha256}"`);
    return response.send(audio.bytes);
  }

  @Post(":id/reopen")
  @HttpCode(200)
  @Header("Cache-Control", "no-store, private")
  reopen(
    @Param("id", uuidV4) id: string,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string
  ): Promise<ReopenOpenCallResponse> {
    return this.reports.reopen(bearerToken(authorization, cookie), id);
  }

  @Delete(":id")
  @Header("Cache-Control", "no-store, private")
  deleteDraft(
    @Param("id", uuidV4) id: string,
    @Headers("x-csrf-token") csrfToken?: string,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string,
  ): Promise<DeleteDraftReportResponse> {
    return this.reports.deleteSyntheticDraft(bearerToken(authorization, cookie), id, csrfToken);
  }

  @Get(":id/active")
  @Header("Cache-Control", "no-store, private")
  async active(
    @Param("id", uuidV4) id: string,
    @Headers("authorization") authorization: string | undefined,
    @Headers("if-none-match") ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) response: ConditionalResponse,
    @Headers("cookie") cookie?: string,
  ): Promise<ActiveReportResource | undefined> {
    const result = await this.reports.active(bearerToken(authorization, cookie), id, ifNoneMatch);
    response.setHeader("ETag", result.etag);
    if (!result.resource) {
      response.status(304);
      return undefined;
    }
    return result.resource;
  }

  @Post(":id/dispatch-conflicts/:conflictId")
  @Header("Cache-Control", "no-store, private")
  resolveDispatchConflict(
    @Param("id", uuidV4) id: string,
    @Param("conflictId", uuidV4) conflictId: string,
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string
  ): Promise<DispatchConflict> {
    return this.reports.resolveDispatchConflict(bearerToken(authorization, cookie), id, conflictId, body);
  }

  @Post(":id/sign")
  @Header("Cache-Control", "no-store, private")
  sign(
    @Param("id", uuidV4) id: string,
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string
  ): Promise<SignedReportResult> {
    return this.signing.sign(bearerToken(authorization, cookie), id, body);
  }

  @Post(":id/review-evaluations")
  @Header("Cache-Control", "no-store, private")
  evaluateReview(
    @Param("id", uuidV4) id: string,
    @Body() body: unknown,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string,
  ): Promise<ValidationReviewEvaluation> {
    return this.reviewValidation.evaluate(bearerToken(authorization, cookie), id, body);
  }

  @Get(":id")
  @Header("Cache-Control", "no-store, private")
  get(
    @Param("id", uuidV4) id: string,
    @Headers("authorization") authorization?: string,
    @Headers("cookie") cookie?: string
  ): Promise<Record<string, unknown>> {
    return this.reports.get(bearerToken(authorization, cookie), id);
  }
}
