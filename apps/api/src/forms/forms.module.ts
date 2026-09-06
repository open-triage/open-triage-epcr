import { Module } from "@nestjs/common";
import { SessionsModule } from "../sessions/sessions.module.js";
import { FormPublicationController } from "./form-publication.controller.js";
import { FormPublicationService } from "./form-publication.service.js";

@Module({
  imports: [SessionsModule],
  controllers: [FormPublicationController],
  providers: [FormPublicationService],
  exports: [FormPublicationService]
})
export class FormsModule {}
