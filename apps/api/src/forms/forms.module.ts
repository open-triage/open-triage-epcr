import { Module } from "@nestjs/common";
import { SessionsModule } from "../sessions/sessions.module.js";
import { FormPublicationService } from "./form-publication.service.js";

@Module({
  imports: [SessionsModule],
  providers: [FormPublicationService],
  exports: [FormPublicationService]
})
export class FormsModule {}
