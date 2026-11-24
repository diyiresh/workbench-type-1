'use strict';
const {sendJson}=require('../lib/http');
module.exports=({readStore})=>[{method:'GET',path:'/api/coordinator/board',local:'coordinator_local_only',handler:({res})=>sendJson(res,200,require('../lib/duty-coordinator').board(readStore()))}];
