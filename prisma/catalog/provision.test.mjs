import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {test} from 'node:test';
import {requireLocalDatabase} from './catalog.mjs';
const url=new URL(requireLocalDatabase(process.env.CATALOG_TEST_DATABASE_URL));
assert.match(url.pathname,/^\/p1_01_catalog(?:_[a-z0-9]+)?$/);
const executable=join(process.env.PG_BIN,process.platform==='win32'?'psql.exe':'psql');
const admin='20000000-0000-4000-8000-000000000001';
const detailer='20000000-0000-4000-8000-000000000002';
function provision(role,actor){
 const result=spawnSync(executable,['-h',url.hostname,'-p',url.port||'5432','-U',decodeURIComponent(url.username),'-d',url.pathname.slice(1),'-v','publisher_role='+role,'-v','actor_staff_id='+actor,'-f','prisma/sql/catalog-publisher.sql'],{encoding:'utf8',shell:false});
 if(result.error)throw result.error;
 return result.status;
}
test('provisioning refuses runtime identity before granting publication',()=>assert.equal(provision('zeus_app',admin),3));
test('provisioning refuses migration owner and privileged identities',()=>assert.equal(provision('postgres',admin),3));
test('provisioning refuses DETAILER actor',()=>assert.equal(provision('p1_catalog_operator',detailer),3));
test('provisioning grants only the dedicated login mapped to an active ADMIN role',()=>assert.equal(provision('p1_catalog_operator',admin),0));