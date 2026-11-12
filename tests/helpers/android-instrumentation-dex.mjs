import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

/** Minimal DEX metadata fixture; includes referenced types that are not definitions. */
export function syntheticDex(definitions,references=[]) {
  const strings=[...new Set([...definitions,...references])];
  const stringOffset=112,typeOffset=stringOffset+strings.length*4,classOffset=typeOffset+strings.length*4,dataOffset=classOffset+definitions.length*32;
  const data=strings.map(value=>{const text=Buffer.from(value);if(text.length>=128)throw Error('Short synthetic descriptor required');return Buffer.concat([Buffer.from([text.length]),text,Buffer.from([0])]);});
  const bytes=Buffer.alloc(dataOffset+data.reduce((sum,row)=>sum+row.length,0));
  bytes.write('dex\n035\0',0,'ascii');bytes.writeUInt32LE(bytes.length,32);bytes.writeUInt32LE(112,36);bytes.writeUInt32LE(0x12345678,40);
  for(const [offset,value]of [[56,strings.length],[60,stringOffset],[64,strings.length],[68,typeOffset],[96,definitions.length],[100,classOffset]])bytes.writeUInt32LE(value,offset);
  let cursor=dataOffset;
  for(let i=0;i<strings.length;i++){bytes.writeUInt32LE(cursor,stringOffset+i*4);bytes.writeUInt32LE(i,typeOffset+i*4);data[i].copy(bytes,cursor);cursor+=data[i].length;}
  for(let i=0;i<definitions.length;i++)bytes.writeUInt32LE(strings.indexOf(definitions[i]),classOffset+i*32);
  return bytes;
}

export function writeInstrumentationSourceFixture(root) {
  const app=join(root,'android/app');mkdirSync(join(app,'src/androidTest/java/fixture'),{recursive:true});
  writeFileSync(join(app,'build.gradle'),'android { }\n');
  writeFileSync(join(app,'src/androidTest/java/fixture/BaselineTest.java'),'package fixture; @RunWith(Runner.class) public class BaselineTest { static class Nested {} String ignored="class Fake {}"; }');
  return syntheticDex(['Lfixture/BaselineTest;']);
}
