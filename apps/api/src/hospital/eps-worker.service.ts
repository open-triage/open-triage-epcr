import { Injectable, type OnModuleInit, type OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { processEpsWork } from './eps-automatic-export.js';
@Injectable()
export class EpsWorkerService implements OnModuleInit,OnModuleDestroy {
 private timer:ReturnType<typeof setTimeout>|undefined;private stopping=false;private running:Promise<void>|undefined;
 constructor(@InjectDataSource() private readonly database:DataSource){}
 onModuleInit(){this.schedule();}
 private schedule(){if(!this.stopping){this.timer=setTimeout(()=>{this.running=this.tick();},5000);this.timer.unref();}}
 private async tick(){try{await processEpsWork(this.database);}catch{console.error(JSON.stringify({event:'eps.worker',code:'worker.failed'}));}finally{this.schedule();}}
 async onModuleDestroy(){this.stopping=true;clearTimeout(this.timer);await this.running;}
}
