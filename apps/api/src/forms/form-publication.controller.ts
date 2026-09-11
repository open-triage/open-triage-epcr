import { Body, Controller, Headers, Param, ParseUUIDPipe, Post, Req } from "@nestjs/common";
import { sessionToken } from "../sessions/clinician-session.controller.js";
import { ClinicianSessionService } from "../sessions/clinician-session.service.js";
import { FormPublicationService } from "./form-publication.service.js";
import type { PublishedFormVersion } from "./form-publication.types.js";

@Controller("form-versions")
export class FormPublicationController {
  constructor(private readonly formPublication: FormPublicationService, private readonly sessions: ClinicianSessionService) {}

  @Post(":id/publish")
  async publish(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown,
    @Req() request: { headers: { cookie?: string } }, @Headers("authorization") authorization?: string): Promise<PublishedFormVersion> {
    const session = await this.sessions.requireCapability(sessionToken(request, authorization), "forms:publish");
    return this.formPublication.publish(id, { ...(body && typeof body === "object" ? body : {}), publishedBy: session.user.id },
      session.organization.id);
  }
}
