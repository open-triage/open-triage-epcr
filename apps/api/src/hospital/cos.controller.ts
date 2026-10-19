import {Body,Controller,Get,Header,Headers,Param,Post,Put,Req} from '@nestjs/common';
import {sessionToken} from '../sessions/clinician-session.controller.js';
import {CosService} from './cos.service.js';
type Request={headers:{cookie?:string}};
@Controller('admin/hospital/cos')
export class CosController {
 constructor(private readonly service:CosService){}
 @Get() @Header('Cache-Control','no-store, private')
 get(@Req() req:Request,@Headers('authorization') auth?:string){return this.service.get(sessionToken(req,auth));}
 @Put() @Header('Cache-Control','no-store, private')
 save(@Body() body:unknown,@Req() req:Request,@Headers('authorization') auth?:string){return this.service.save(sessionToken(req,auth),body);}
 @Post('test') @Header('Cache-Control','no-store, private')
 test(@Body() body:unknown,@Req() req:Request,@Headers('authorization') auth?:string){return this.service.test(sessionToken(req,auth),body);}
 @Post('activate') @Header('Cache-Control','no-store, private')
 activate(@Body() body:unknown,@Req() req:Request,@Headers('authorization') auth?:string){return this.service.activate(sessionToken(req,auth),body);}
 @Post('deactivate') @Header('Cache-Control','no-store, private')
 deactivate(@Body() body:unknown,@Req() req:Request,@Headers('authorization') auth?:string){return this.service.activate(sessionToken(req,auth),body,true);}
 @Get('files') @Header('Cache-Control','no-store, private')
 files(@Req() req:Request,@Headers('authorization') auth?:string){return this.service.files(sessionToken(req,auth));}
 @Post('import-file') @Header('Cache-Control','no-store, private')
 importFile(@Body() body:unknown,@Req() req:Request,@Headers('authorization') auth?:string){return this.service.importFile(sessionToken(req,auth),body);}
 @Get('export/:revision') @Header('Cache-Control','no-store, private')
 export(@Param('revision') revision:string,@Req() req:Request,@Headers('authorization') auth?:string){return this.service.export(sessionToken(req,auth),revision);}
}
