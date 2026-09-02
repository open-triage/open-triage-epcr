import { Body, Controller, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { FormPublicationService } from "./form-publication.service.js";
import type { PublishedFormVersion } from "./form-publication.types.js";

@Controller("form-versions")
export class FormPublicationController {
  constructor(private readonly formPublication: FormPublicationService) {}

  @Post(":id/publish")
  publish(@Param("id", new ParseUUIDPipe()) id: string, @Body() body: unknown): Promise<PublishedFormVersion> {
    return this.formPublication.publish(id, body);
  }
}
