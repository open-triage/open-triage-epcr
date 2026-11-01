import {Body,Controller,Get,Header,Headers,Param,ParseUUIDPipe,Post,Put,Query,Req} from '@nestjs/common';
import {sessionToken} from '../sessions/clinician-session.controller.js';
import {DestinationService} from './destination.service.js';
type RequestLike={headers:{cookie?:string}};
@Controller()
export class DestinationController {
 constructor(private readonly directory:DestinationService){}
 @Get('destinations') @Header('Cache-Control','no-store, private')
 recommendations(@Req() request:RequestLike,@Headers('authorization') auth?:string,@Query('search') search?:string,@Query('cursor') cursor?:string){return this.directory.list(sessionToken(request,auth),search,cursor);}
 @Get('admin/destinations') @Header('Cache-Control','no-store, private')
 list(@Req() request:RequestLike,@Headers('authorization') auth?:string,@Query('search') search?:string,@Query('cursor') cursor?:string){return this.directory.list(sessionToken(request,auth),search,cursor,true);}
 @Post('admin/destinations')
 create(@Req() request:RequestLike,@Body() body:unknown,@Headers('authorization') auth?:string){return this.directory.save(sessionToken(request,auth),null,body);}
 @Put('admin/destinations/:id')
 update(@Param('id',new ParseUUIDPipe()) id:string,@Req() request:RequestLike,@Body() body:unknown,@Headers('authorization') auth?:string){return this.directory.save(sessionToken(request,auth),id,body);}
}
