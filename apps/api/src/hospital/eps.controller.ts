import {EpsImportService} from './eps-import.service.js';
import { Body, Post, Controller, Get, Header, Headers, Param, ParseUUIDPipe, Query, Res } from '@nestjs/common';
import { bearerToken } from '../sessions/clinician-session.controller.js';
import { EpsService } from './eps.service.js';
@Controller('reports/:id/eps')
export class EpsController {
 constructor(private readonly service:EpsService,private readonly imports:EpsImportService){}
 @Get('context') @Header('Cache-Control','no-store, private')
 async context(@Param('id',new ParseUUIDPipe({version:'4'})) id:string,@Res() response:{json(value:unknown):unknown},@Headers('authorization') auth?:string,@Headers('cookie') cookie?:string){
  // Nest sends an empty body for a returned null; clients require JSON null
  // to distinguish an inactive integration from a failed context request.
  response.json(await this.service.context(bearerToken(auth,cookie),id));
 }
 @Get('outgoing') @Header('Cache-Control','no-store, private')
 outgoing(@Param('id',new ParseUUIDPipe({version:'4'})) id:string,@Query('binding') binding:string,@Headers('authorization') auth?:string,@Headers('cookie') cookie?:string){return this.service.outgoing(bearerToken(auth,cookie),id,binding);}
 @Get('imports/history') @Header('Cache-Control','no-store, private')
 history(@Param('id',new ParseUUIDPipe({version:'4'})) id:string,@Headers('authorization') auth?:string,@Headers('cookie') cookie?:string){return this.imports.history(bearerToken(auth,cookie),id);}
 @Get('imports') @Header('Cache-Control','no-store, private')
 rows(@Param('id',new ParseUUIDPipe({version:'4'})) id:string,@Query('binding') binding:string,@Headers('authorization') auth?:string,@Headers('cookie') cookie?:string){return this.imports.rows(bearerToken(auth,cookie),id,binding);}
 @Post('imports/plan') @Header('Cache-Control','no-store, private')
 plan(@Param('id',new ParseUUIDPipe({version:'4'})) id:string,@Body() body:unknown,@Headers('authorization') auth?:string,@Headers('cookie') cookie?:string){return this.imports.plan(bearerToken(auth,cookie),id,body);}
 @Post('imports/apply') @Header('Cache-Control','no-store, private')
 apply(@Param('id',new ParseUUIDPipe({version:'4'})) id:string,@Body() body:unknown,@Headers('authorization') auth?:string,@Headers('cookie') cookie?:string){return this.imports.apply(bearerToken(auth,cookie),id,body);}
 @Get() @Header('Cache-Control','no-store, private')
 lookup(@Param('id',new ParseUUIDPipe({version:'4'})) id:string,@Query('binding') binding:string,@Headers('authorization') auth?:string,@Headers('cookie') cookie?:string){return this.service.lookup(bearerToken(auth,cookie),id,binding);}
}
