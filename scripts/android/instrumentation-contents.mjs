import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,readdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';

/** Definitions, not mere string references: an omitted test cannot run on a device. */
export function dexClassDefinitions(bytes) {
  assert(Buffer.isBuffer(bytes)&&bytes.length>=112,'Instrumentation DEX header is missing');
  assert.match(bytes.subarray(0,8).toString('ascii'),/^dex\n0[0-9]{2}\0$/,'Unsupported instrumentation DEX header');
  assert.equal(bytes.readUInt32LE(32),bytes.length,'Instrumentation DEX length differs');
  assert.equal(bytes.readUInt32LE(40),0x12345678,'Instrumentation DEX must use normal byte order');
  const range=(offset,length)=>{assert(Number.isSafeInteger(offset)&&Number.isSafeInteger(length)&&offset>=0&&length>=0&&offset+length<=bytes.length,'Instrumentation DEX table is truncated');};
  const table=(sizeAt,offsetAt,width)=>{const size=bytes.readUInt32LE(sizeAt),offset=bytes.readUInt32LE(offsetAt);range(offset,size*width);return{size,offset};};
  const strings=table(56,60,4),types=table(64,68,4),classes=table(96,100,32);
  const result=new Set();
  for(let i=0;i<classes.size;i++) {
    const type=bytes.readUInt32LE(classes.offset+i*32);assert(type<types.size,'Invalid DEX class type');
    const string=bytes.readUInt32LE(types.offset+type*4);assert(string<strings.size,'Invalid DEX class descriptor index');
    let cursor=bytes.readUInt32LE(strings.offset+string*4);range(cursor,1);
    // Skip the bounded ULEB128 UTF-16 length; descriptor termination is checked below.
    let end=false;for(let j=0;j<5;j++){range(cursor,1);if(!(bytes[cursor++]&128)){end=true;break;}}
    assert(end,'Invalid DEX descriptor length');
    const zero=bytes.indexOf(0,cursor);assert(zero>=cursor,'Unterminated DEX class descriptor');
    const descriptor=bytes.subarray(cursor,zero).toString('utf8');
    // D8-generated class names may contain '-' (for example desugared helpers).
    assert.match(descriptor,/^L[^.;\[\]\x00-\x20]+;$/,'Invalid DEX class descriptor');result.add(descriptor);
  }
  return result;
}

export function expectedInstrumentationClasses(root,variant) {
  assert(['debug','release'].includes(variant),'Known instrumentation variant required');
  const app=resolve(root,'android/app'),gradle=readFileSync(join(app,'build.gradle'),'utf8');
  const directories=new Set([join(app,'src/androidTest/java')]);
  for(const match of gradle.matchAll(/\bandroidTest\.java\.srcDir\s+["']([^"']+)["']/g)) {
    const directory=resolve(app,match[1]);assert(directory.startsWith(app+sep),'Instrumentation source must stay inside the app');directories.add(directory);
  }
  const specific=join(app,`src/androidTest${variant==='debug'?'Debug':'Release'}/java`);
  if(existsSync(specific))directories.add(specific);
  const expected=new Set();
  for(const directory of directories) {
    assert(existsSync(directory),'Configured instrumentation source directory is missing');
    const files=readdirSync(directory,{recursive:true,withFileTypes:true}).filter(row=>row.isFile()&&row.name.endsWith('.java'));
    assert(files.length,'Configured instrumentation source directory has no Java inputs');
    for(const file of files) {
      const source=readFileSync(join(file.parentPath,file.name),'utf8').replace(/"""[\s\S]*?"""|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,' ');
      const pkg=/\bpackage\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*;/.exec(source)?.[1];
      assert(pkg,'Instrumentation Java input must declare its package');
      const tokens=source.match(/[A-Za-z_$][\w$]*|[{}.]/g)??[];let depth=0;
      for(let i=0;i<tokens.length;i++) {
        if(tokens[i]==='{')depth++;else if(tokens[i]==='}')depth--;
        else if(depth===0&&tokens[i-1]!=='.'&&['class','interface','enum','record'].includes(tokens[i])) {
          const name=tokens[++i];assert(/^[A-Za-z_$][\w$]*$/.test(name),'Invalid top-level instrumentation declaration');
          expected.add('L'+pkg.replaceAll('.','/')+'/'+name+';');
        }
      }
    }
  }
  assert(expected.size,'Instrumentation source declares no top-level classes');return expected;
}

export function readInstrumentationApkDex(apk) {
  assert(existsSync(apk),'Actual instrumentation APK is missing');
  // Native validation already requires the JDK; do not add an optional unzip dependency.
  const jar=process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin/jar'):'jar';
  const entries=execFileSync(jar,['--list','--file',resolve(apk)],{encoding:'utf8',maxBuffer:2*1024*1024}).split(/\r?\n/).filter(name=>/^classes(?:[2-9]|[1-9][0-9]+)?\.dex$/.test(name));
  assert(entries.length,'Actual instrumentation APK contains no DEX');
  assert.equal(new Set(entries).size,entries.length,'Duplicate instrumentation DEX entries');
  const directory=mkdtempSync(join(tmpdir(),'android-instrumentation-dex-'));
  try {
    execFileSync(jar,['--extract','--file',resolve(apk),...entries],{cwd:directory,timeout:30000});
    return entries.map(name=>readFileSync(join(directory,name)));
  }finally{rmSync(directory,{recursive:true,force:true});}
}

export function verifyInstrumentationClasses(root,variant,{readDex=readInstrumentationApkDex,apk}={}) {
  const expected=expectedInstrumentationClasses(root,variant);
  const artifact=apk??join(root,`android/app/build/outputs/apk/androidTest/${variant}/app-${variant}-androidTest.apk`);
  const dex=readDex(artifact);assert(Array.isArray(dex)&&dex.length,'Instrumentation DEX inputs are missing');
  const defined=new Set(dex.flatMap(bytes=>[...dexClassDefinitions(bytes)]));
  for(const descriptor of expected)assert(defined.has(descriptor),'Instrumentation APK omitted source class '+descriptor+'; inspect the variant compile inputs and perform a targeted fresh instrumentation compile before retrying');
  return{expectedClasses:expected.size,definedClasses:defined.size};
}
