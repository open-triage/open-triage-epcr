import {Body,Controller,Get,Header,Headers,Param,ParseUUIDPipe,Post,Query} from '@nestjs/common';
import {bearerToken} from '../sessions/clinician-session.controller.js';
import {EpsSubmissionService} from './eps-submission.service.js';
@Controller('reports/:id/eps/submissions')
export class EpsSubmissionController{
 constructor(private readonly service:EpsSubmissionService){}
 @Get() @Header('Cache-Control','no-store, private')
 history(@Param('id',new ParseUUIDPipe({version:'4'})) id:string,@Query('dataset') dataset:string,@Headers('authorization') auth?:string,@Headers('cookie') cookie?:string){return this.service.history(bearerToken(auth,cookie),id,dataset);}
 @Post('preview') @Header('Cache-Control','no-store, private')
 preview(@Param('id',new ParseUUIDPipe({version:'4'})) id:string,@Body() body:unknown,@Headers('authorization') auth?:string,@Headers('cookie') cookie?:string,@Headers('x-csrf-token') csrf?:string){return this.service.preview(bearerToken(auth,cookie),id,body,csrf);}
 @Post('submit') @Header('Cache-Control','no-store, private')
 submit(@Param('id',new ParseUUIDPipe({version:'4'})) id:string,@Body() body:unknown,@Headers('authorization') auth?:string,@Headers('cookie') cookie?:string,@Headers('x-csrf-token') csrf?:string){return this.service.submit(bearerToken(auth,cookie),id,body,csrf);}
}
