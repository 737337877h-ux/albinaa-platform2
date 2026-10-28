'use strict';
// Builds an isolated checking package from the exact user-supplied vendor source.
// Never runs SQL or edits the original GLS_LMT_PKG.
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const SOURCE_HASH = 'a3dcc38e594b529bf6478177f797c9b37c6f29131f0fdd672d8e565974757636';
function build(bytes) {
  if (createHash('sha256').update(bytes).digest('hex') !== SOURCE_HASH) throw Error('Source changed: review the new version before generating SQL');
  const rows = bytes.toString('utf8').split(/\r?\n/);
  const extract = kind => rows.flatMap(line => {
    const match = line.match(/^(PACKAGE(?: BODY)?)\|(\d{6})\|(.*)$/);
    return match && match[1] === kind ? [{ n: Number(match[2]), text: match[3] }] : [];
  });
  const spec = extract('PACKAGE'), body = extract('PACKAGE BODY');
  if (spec.length !== 88 || body.length !== 1514 || body.some((line,i) => line.n !== i+1)) throw Error('Incomplete source');
  // Only keep the four helpers needed for CHK_AC_LMT. The unrelated general
  // account-use checker is not exposed in the derived package.
  let specification = spec.filter(l => l.n <= 80 || l.n === 88).map(l => l.text).join('\n');
  const replace = new Map();
  function range(first, last, replacement) {
    replace.set(first, replacement);
    for(let n=first+1;n<=last;n++) replace.set(n,'');
  }
  range(13,15,'EXCEPTION WHEN OTHERS THEN RAISE;');
  range(95,96,'EXCEPTION WHEN OTHERS THEN RAISE;');
  range(105,106,'EXCEPTION WHEN OTHERS THEN RAISE;');
  range(192,193,'EXCEPTION WHEN NO_DATA_FOUND THEN V_CNT_ACC:=0; WHEN OTHERS THEN RAISE;');
  range(224,225,'EXCEPTION WHEN OTHERS THEN RAISE;');
  range(245,246,'EXCEPTION WHEN NO_DATA_FOUND THEN V_Dr_Cr2:=NULL; WHEN OTHERS THEN RAISE;');
  range(273,274,'EXCEPTION WHEN NO_DATA_FOUND THEN V_Dr_Cr2:=NULL; WHEN OTHERS THEN RAISE;');
  // COUNT and selection must agree. An unexpected missing/ambiguous limit is an
  // error, never permission to proceed.
  range(299,304,'EXCEPTION WHEN OTHERS THEN RAISE;');
  // Remove the entire facility-update branch even though the wrapper fixes P_UPD_FLG=0.
  range(368,387,'-- Facility updates are excluded from this read-only checker.');
  range(815,817,'EXCEPTION WHEN OTHERS THEN RAISE;');
  range(887,889,'EXCEPTION WHEN OTHERS THEN RAISE;');
  range(1184,1186,'EXCEPTION WHEN OTHERS THEN RAISE;');
  // Keep the vendor zero-denominator message fallback; other failures propagate.
  for(const n of [445,472,512,559,590,611,632,654,681,707,730,751,772,793]) {
    replace.set(n,body[n-1].text.replace(/WHEN OTHERS/i,'WHEN ZERO_DIVIDE'));
  }
  replace.set(81,'SELECT NVL(AC_DTL_TYP,0) INTO V_AC_DTL_TYP FROM ACCOUNT WHERE A_CODE=P_AC_CODE;');
  range(935,937,'SELECT COUNT(*) INTO V_CNT FROM IAS_POST_DTL WHERE C_V_CODE IS NOT NULL AND ROWNUM<=1;');
  let implementation = body.filter(l=>l.n<=1406).map(l=>replace.has(l.n)?replace.get(l.n):l.text).join('\n')+'\nEND GLS_LMT_PKG;';
  // Remove vendor comments before checking executable tokens.
  const clean = value => value.replace(/\/\*[\s\S]*?\*\//g,'').replace(/--[^\n]*/g,'')
    .replace(/GLS_LMT_PKG/gi,'ALBINAA_SO_CREDIT_ENGINE').replace(/\n\s*\n/g,'\n');
  specification=clean(specification); implementation=clean(implementation);
  const forbidden=/\b(INSERT|UPDATE|DELETE|MERGE|COMMIT|ROLLBACK|AUTONOMOUS_TRANSACTION|EXECUTE\s+IMMEDIATE|NEXTVAL)\b/i;
  if(forbidden.test(implementation))throw Error('Generated checker contains a mutation');
  const header=`-- Generated from reviewed GLS_LMT_PKG export SHA256 ${SOURCE_HASH}.
-- Creates NEW objects only. Does not replace vendor objects or change business data.
-- Grant is limited to the wrapper; no EXECUTE on the checking engine or vendor package.
SET DEFINE OFF
SET SQLBLANKLINES ON
SET LINESIZE 220
WHENEVER SQLERROR EXIT SQL.SQLCODE
`;
  const wrapper=`CREATE FUNCTION IAS20261.ALBINAA_SO_CREDIT_CHECK (
 P_C_CODE IN VARCHAR2, P_CUR_CODE IN VARCHAR2, P_DOC_DATE IN DATE, P_AMOUNT IN NUMBER
) RETURN VARCHAR2 AUTHID DEFINER AS
 v_account VARCHAR2(30); v_customer_count NUMBER; v_local VARCHAR2(7); v_rate NUMBER;
 v_precision NUMBER; v_gl_type NUMBER; v_local_limits NUMBER; v_check NUMBER;
 v_min NUMBER; v_max NUMBER; v_min_trns NUMBER; v_max_trns NUMBER;
 v_pass NUMBER; v_priv NUMBER; v_no_override NUMBER; v_msg VARCHAR2(4000);
BEGIN
 IF P_C_CODE IS NULL OR P_CUR_CODE IS NULL OR P_DOC_DATE IS NULL OR
    P_AMOUNT IS NULL OR P_AMOUNT<=0 OR EXTRACT(YEAR FROM P_DOC_DATE)<>2026 THEN
   RAISE_APPLICATION_ERROR(-20051,'Invalid sales-order credit input');
 END IF;
 SELECT COUNT(*),MAX(C_A_CODE) INTO v_customer_count,v_account FROM IAS20261.CUSTOMER
 WHERE C_CODE=P_C_CODE AND NVL(INACTIVE,0)=0 AND NVL(INACTIVE_SALES,0)=0 AND NVL(BLK_LST,0)=0;
 IF v_customer_count<>1 OR v_account IS NULL THEN
   RAISE_APPLICATION_ERROR(-20052,'Customer account is unavailable');
 END IF;
 SELECT NO_OF_DECIMAL_AR,NVL(CHECK_LMT_SORDER,1),NVL(USE_CST_CR_LMT_LOCAL,0)
 INTO v_precision,v_check,v_local_limits FROM IAS20261.IAS_PARA_AR;
 SELECT GL_LMT_TYPE INTO v_gl_type FROM IAS20261.IAS_PARA_GL;
 IF v_gl_type IS NULL OR v_gl_type<>1 OR v_local_limits<>0 OR v_check<>1 OR
    v_precision IS NULL OR v_precision<>TRUNC(v_precision) OR v_precision<0 OR v_precision>6 THEN
   RAISE_APPLICATION_ERROR(-20053,'Unsupported credit settings; review required');
 END IF;
 SELECT CUR_CODE INTO v_local FROM IAS20261.EX_RATE WHERE L_F=1;
 SELECT CUR_RATE INTO v_rate FROM IAS20261.EX_RATE WHERE CUR_CODE=P_CUR_CODE AND CUR_RATE>0;
 IAS20261.ALBINAA_SO_CREDIT_ENGINE.V_DALY_BLNC:=0;
 IAS20261.ALBINAA_SO_CREDIT_ENGINE.V_MNTHLY_BLNC:=0;
 IAS20261.ALBINAA_SO_CREDIT_ENGINE.V_ANULY_BLNC:=0;
 IAS20261.ALBINAA_SO_CREDIT_ENGINE.V_BLNC:=0;
 IAS20261.ALBINAA_SO_CREDIT_ENGINE.CHK_AC_LMT(
   P_DR_CR=>1,P_DOC_DATE=>TRUNC(P_DOC_DATE),P_AMT=>P_AMOUNT*v_rate,
   P_AMTF=>CASE WHEN P_CUR_CODE=v_local THEN 0 ELSE P_AMOUNT END,
   P_AMT_TRNS=>P_AMOUNT*v_rate,P_AMTF_TRNS=>CASE WHEN P_CUR_CODE=v_local THEN 0 ELSE P_AMOUNT END,
   P_AC_CODE=>v_account,P_AC_CODE_DTL=>P_C_CODE,P_CC_CODE=>NULL,P_PJ_NO=>NULL,P_ACTV_NO=>NULL,
   P_BRN_NO=>1,P_USER_NO=>1,P_CUR_CODE=>P_CUR_CODE,P_FRC_NO=>v_precision,
   P_MIN_LMT=>v_min,P_MAX_LMT=>v_max,P_MIN_TRNS_LMT=>v_min_trns,P_MAX_TRNS_LMT=>v_max_trns,
   P_PASS=>v_pass,P_PASS_PRV=>v_priv,P_NO_CHK_PRV=>v_no_override,P_UPD_FLG=>0,P_MSG=>v_msg,P_LNG=>1);
 -- Administrator override privileges are not inherited by platform users.
 IF NVL(v_no_override,0)<>0 OR TRIM(v_msg) IS NOT NULL THEN
   RETURN 'BLOCK:'||SUBSTR(NVL(v_msg,'Credit limit exceeded'),1,1000);
 END IF;
 IF v_priv IS NULL OR v_priv NOT IN (1,2,3) THEN
   RAISE_APPLICATION_ERROR(-20054,'Credit validation did not complete');
 END IF;
 RETURN 'OK';
END;
/
SHOW ERRORS FUNCTION IAS20261.ALBINAA_SO_CREDIT_CHECK
`;
  const verify=`DECLARE n NUMBER; BEGIN
 SELECT COUNT(*) INTO n FROM DBA_OBJECTS WHERE OWNER='IAS20261'
 AND OBJECT_NAME IN ('ALBINAA_SO_CREDIT_ENGINE','ALBINAA_SO_CREDIT_CHECK') AND STATUS='VALID';
 IF n<>3 THEN RAISE_APPLICATION_ERROR(-20055,'Credit checker compilation failed; no grant applied'); END IF;
END;
/
GRANT EXECUTE ON IAS20261.ALBINAA_SO_CREDIT_CHECK TO ALBINAA20261WRITER;
SELECT OBJECT_NAME,OBJECT_TYPE,STATUS FROM DBA_OBJECTS WHERE OWNER='IAS20261'
AND OBJECT_NAME IN ('ALBINAA_SO_CREDIT_ENGINE','ALBINAA_SO_CREDIT_CHECK') ORDER BY OBJECT_NAME,OBJECT_TYPE;
WHENEVER SQLERROR CONTINUE
SET DEFINE ON
`;
  return header+'CREATE '+specification.replace(/^PACKAGE\s+/i,'PACKAGE IAS20261.')+'\n/\nSHOW ERRORS PACKAGE IAS20261.ALBINAA_SO_CREDIT_ENGINE\n'
    +'CREATE '+implementation.replace(/^PACKAGE\s+BODY\s+/i,'PACKAGE BODY IAS20261.')+'\n/\nSHOW ERRORS PACKAGE BODY IAS20261.ALBINAA_SO_CREDIT_ENGINE\n'
    +wrapper+verify;
}
if(require.main===module){const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node build-sales-order-credit-check.js source.txt output.sql');fs.writeFileSync(output,build(fs.readFileSync(input)));}
module.exports={build,SOURCE_HASH};
