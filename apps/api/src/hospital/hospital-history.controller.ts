import {Controller,Get,Header,Headers,Param,Query,Req} from '@nestjs/common';
import {sessionToken} from '../sessions/clinician-session.controller.js';
import {HospitalHistoryService} from './hospital-history.service.js';
@Controller('admin/hospital/history')
export class HospitalHistoryController{
 constructor(private readonly service:HospitalHistoryService){}
 @Get() @Header('Cache-Control','no-store, private')
 list(@Query() query:Record<string,unknown>,@Req() req:{headers:{cookie?:string}},@Headers('authorization') auth?:string){return this.service.list(sessionToken(req,auth),query);}
 @Get('review/:reportId') @Header('Cache-Control','no-store, private')
 link(@Param('reportId') reportId:string,@Query('dataset') dataset:string,@Req() req:{headers:{cookie?:string}},@Headers('authorization') auth?:string){return this.service.link(sessionToken(req,auth),reportId,dataset);}
}
