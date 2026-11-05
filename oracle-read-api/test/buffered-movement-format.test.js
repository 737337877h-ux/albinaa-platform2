'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('buffered transport preserves historical decimal precision and CSV escaping', { skip: process.platform !== 'win32' || !fs.existsSync('C:/OraNT/Bin/oci.dll') }, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'albinaa-buffered-format-'));
  const input = path.join(directory, 'input.json'), output = path.join(directory, 'output.csv');
  try {
    fs.writeFileSync(input, JSON.stringify({ columns:['AMOUNT','SERIAL','DESCRIPTION','MISSING','FLOAT'], types:[139,131,200,139,5],
      rows:[['562.46426857142519664296','202600000100002200000002023','نص "مقتبس"\nسطر ثان',null,'8.88955736987255499461059560582668803626'],
        ['0.937','202600000100002100000000000000','0', '1','0.937']] }));
    const result = spawnSync(path.join(process.env.SystemRoot, 'SysWOW64/WindowsPowerShell/v1.0/powershell.exe'),
      ['-NoProfile','-NonInteractive','-File',path.resolve(__dirname,'../scripts/format-compatible-movement-json.ps1'),'-InputFile',input,'-OutputFile',output],
      { encoding:'utf8',windowsHide:true,timeout:30000,
        env:{...process.env,ORA_NLS33:path.join(directory,'missing-nls'),ORA_NLS32:path.join(directory,'missing-nls')} });
    assert.equal(result.status,0,result.stderr);
    assert.equal(fs.readFileSync(output,'utf8'), '"AMOUNT","SERIAL","DESCRIPTION","MISSING","FLOAT"\r\n'
      +'"562.46426857142519664296","202600000100002200000002023","نص ""مقتبس""\nسطر ثان","","8.88955736987255"\r\n'
      +'"0.937","","0","1","0.937"\r\n');
  } finally { fs.rmSync(directory,{recursive:true,force:true}); }
});
