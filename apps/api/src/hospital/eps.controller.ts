import { Controller, Get, Header, Headers, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { bearerToken } from '../sessions/clinician-session.controller.js';
import { EpsService } from './eps.service.js';
@Controller('reports/:id/eps')
export class EpsController {
 constructor(private readonly service:EpsService){}
 @Get('context') @Header('Cache-Control','no-store, private')
 context(@Param('id',new ParseUUIDPipe({version:'4'})) id:string,@Headers('authorization') auth?:string,@Headers('cookie') cookie?:string){return this.service.context(bearerToken(auth,cookie),id);}
 @Get() @Header('Cache-Control','no-store, private')
 lookup(@Param('id',new ParseUUIDPipe({version:'4'})) id:string,@Query('binding') binding:string,@Headers('authorization') auth?:string,@Headers('cookie') cookie?:string){return this.service.lookup(bearerToken(auth,cookie),id,binding);}
}
