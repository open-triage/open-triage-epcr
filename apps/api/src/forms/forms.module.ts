import { Module } from "@nestjs/common";
import { FormPublicationController } from "./form-publication.controller.js";
import { FormPublicationService } from "./form-publication.service.js";

@Module({
  controllers: [FormPublicationController],
  providers: [FormPublicationService]
})
export class FormsModule {}
