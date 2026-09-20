// Local-only HTTP acceptance plus optional Jev receipt-review comparison.
// No credentials, auth tokens, user payloads or production data are retained/sent.
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const base = process.env.ARENA_TEST_URL || 'http://127.0.0.1:8797';
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(base)) throw new Error('Local test URL required');
const useJev = process.argv.includes('--jev');
if (useJev && !process.env.TYPESAFE_API_KEY) throw new Error('TYPESAFE_API_KEY required');
const output = process.argv.find(a => a.startsWith('--output='))?.slice(9);
if (!output) throw new Error('Use --output=<new receipt path>');
const cases = [];
// Local-only independent client per run: keep rate limits active without
// earlier test attempts preempting the token-replay handler being measured.
const clientBytes = crypto.getRandomValues(new Uint8Array(2));
const clientIP = `198.18.${clientBytes[0]}.${clientBytes[1]}`;
const check = (id, requirement, expected, observed) => cases.push({ id, requirement, expected, observed, origin: 'local_http' });
async function req(method,path,body,token) {
  const r = await fetch(base+path,{method,headers:{'Content-Type':'application/json','CF-Connecting-IP':clientIP,...(token?{Authorization:`Bearer ${token}`}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  return {status:r.status,body:await r.json()};
}
const start=performance.now();
check('anonymous_profile','Unauthenticated profile access is denied',401,(await req('GET','/api/users/me')).status);
const suffix=crypto.randomUUID().slice(0,8);
const reg=await req('POST','/api/auth/register',{email:`wire-${suffix}@example.com`,username:`wire_${suffix}`,display_name:'Local wiring fixture',password:`Aa!${crypto.randomUUID()}`,role:'admin',verification_status:'verified',email_verified:true});
check('registration','Valid local registration succeeds',200,reg.status);
const user=reg.body.data?.user; const token=reg.body.data?.token; const verifyToken=reg.body.data?.dev_verification_token;
check('role_assignment','Registration cannot grant a client-requested administrator role','voter',user?.role ?? null);
check('unconfirmed_email','A newly registered account is not email-confirmed',false,user?.email_verified ?? null);
check('unconfirmed_write','Participation before email confirmation is denied',403,(await req('POST','/api/surveys/my-priorities',{priorities:[{issue_category_id:'cat-1',priority_rank:1}]},token)).status);
if(!token || !verifyToken) throw new Error('Local development registration did not return expected fixture tokens; stopping');
check('email_confirmation','An issued confirmation token is accepted',200,(await req('POST','/api/auth/verify-email',{token:verifyToken})).status);
const me=await req('GET','/api/auth/me',undefined,token);
check('identity_boundary','Email confirmation must not promote generic identity status','unverified',me.body.data?.user?.verification_status ?? null);
check('confirmed_write','Email-confirmed participant can save priorities',200,(await req('POST','/api/surveys/my-priorities',{priorities:[{issue_category_id:'cat-1',priority_rank:1}]},token)).status);
check('campaign_authority','Ordinary participants cannot verify candidates',403,(await req('POST','/api/candidates/cand-1/verify',{action:'verify'},token)).status);
check('profile_escalation','A profile update containing only protected fields is rejected',400,(await req('PUT','/api/users/me',{role:'admin',verification_status:'verified'},token)).status);
check('token_replay','Used email-confirmation tokens cannot be reused',400,(await req('POST','/api/auth/verify-email',{token:verifyToken})).status);
check('logout','A logged-in account can revoke its session',200,(await req('POST','/api/auth/logout',{},token)).status);
check('revoked_session','A revoked session cannot read the private profile',401,(await req('GET','/api/users/me',undefined,token)).status);
const races=await req('GET','/api/races?status=all&limit=1&page=1&sort=name');
check('directory_route','Directory pagination endpoint succeeds',200,races.status);
check('directory_page','Requested one-row page is bounded',true,Array.isArray(races.body.data?.races)&&races.body.data.races.length<=1);
const httpMs=performance.now()-start;
// Explicitly synthetic mutations of captured receipts, never relabeled executions.
const altered=cases.filter(c=>['anonymous_profile','campaign_authority','token_replay','revoked_session'].includes(c.id)).map(c=>({...c,id:`mutated_${c.id}`,observed:200,origin:'synthetic_receipt_mutation'}));
altered.push({...cases.find(c=>c.id==='role_assignment'),id:'mutated_role',observed:'admin',origin:'synthetic_receipt_mutation'});
const unknown={id:'not_executed',requirement:'A user must be able to recover their account through delivered email',expected:200,observed:null,origin:'unexecuted_control'};
const all=[...cases,...altered,unknown];
const baselineStart=performance.now();
const baseline=Object.fromEntries(all.map(c=>[c.id,c.observed===null?'unavailable':c.observed===c.expected?'satisfied':'violated']));
const baselineMs=performance.now()-baselineStart;
let jev=null;
if(useJev){
  const state={cases:all.map(({origin,...c})=>c)};
  const questions=Object.fromEntries(all.map(c=>[c.id,{type:'choice',instructions:`For the case with id ${c.id} in cases, does its observed result satisfy its requirement and expected value? Judge only recorded values, not desired behavior. A null observation means no execution evidence.`,criteria:{satisfied:'Observed value equals required expected value',violated:'Observed value conflicts with required expected value',unavailable:'Observation is null, so execution evidence is missing'}}]));
  const request={model:'jev-latest',state,questions};
  const t=performance.now();
  const r=await fetch('https://api.typesafe.ai/v1/systemone',{method:'POST',headers:{Authorization:`Bearer ${process.env.TYPESAFE_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(60000)});
  if(!r.ok) throw new Error(`TypeSafe returned HTTP ${r.status}; response withheld`);
  const data=await r.json();
  const answers=Object.fromEntries(all.map(c=>{const a=data.answers?.[c.id];if(!a||!['satisfied','violated','unavailable'].includes(a.choice))throw new Error('Invalid Jev answer');return[c.id,{choice:a.choice,confidence:a.confidence,probabilities:a.probabilities}]}));
  jev={model:data.model,usage:data.usage,wall_ms:performance.now()-t,request,answers,agreement:all.filter(c=>answers[c.id].choice===baseline[c.id]).length,total:all.length,invoice_cost:null};
}
const report={created_at:new Date().toISOString(),execution_commit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),working_diff_sha256:createHash('sha256').update(execFileSync('git',['diff','HEAD'])).digest('hex'),script_sha256:createHash('sha256').update(await fs.readFile(new URL(import.meta.url))).digest('hex'),http_ms:httpMs,live_passes:cases.filter(c=>baseline[c.id]==='satisfied').length,live_total:cases.length,cases:all,baseline,baseline_ms:baselineMs,jev};
await fs.writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({receipt:output,live_passes:report.live_passes,live_total:report.live_total,jev_agreement:jev?.agreement,comparison_cases:jev?.total,usage:jev?.usage,jev_ms:jev?.wall_ms}));
if(report.live_passes!==report.live_total)process.exitCode=1;
