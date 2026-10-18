'use strict';
const $ = (s) => document.querySelector(s);
const app = $('#app');
const routes = {overview:'工作台',materials:'求职材料',analysis:'诊断与匹配',interview:'模拟面试',history:'训练档案'};
const dims = {relevance:'回答相关性',completeness:'内容完整性',consistency:'事实一致性',clarity:'表达清晰度',star:'STAR 结构',competency:'岗位能力'};
const state = {projectId:localStorage.getItem('careerlens.project'), sessionId:localStorage.getItem('careerlens.session'), projects:[], sessions:[], health:null, busy:false, dirty:false, route:'overview'};
let toastTimer, pageToken = 0;

function el(tag, attrs={}, ...children) {
  const node = document.createElement(tag);
  for (const [key,value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2),value);
    else if (key === 'class') node.className=value;
    else if (key === 'text') node.textContent=value;
    else if (value !== false && value != null) node.setAttribute(key,value === true ? '' : value);
  }
  children.flat(Infinity).forEach(c => {if(c!=null) node.append(c instanceof Node ? c : document.createTextNode(String(c)));});
  return node;
}
function toast(text,error=false){clearTimeout(toastTimer);const n=$('#toast');n.textContent=text;n.hidden=false;n.className=error?'error':'';toastTimer=setTimeout(()=>n.hidden=true,error?9500:4000);}
async function api(path, opts={}) {
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),240000);
  try {
    const res=await fetch('/api'+path,{...opts,signal:controller.signal,headers:opts.body instanceof FormData?{}:{'Content-Type':'application/json'},body:opts.body instanceof FormData?opts.body:opts.body?JSON.stringify(opts.body):undefined});
    if(!res.ok){let data;try{data=await res.json();}catch{throw new Error(`服务返回 ${res.status}，请检查终端日志`);}
      throw new Error(Array.isArray(data.detail)?data.detail.map(x=>`${x.loc.slice(1).join('.')}: ${x.msg}`).join('；'):data.detail||`请求失败 ${res.status}`);}
    return res.status===204?null:await res.json();
  } catch(err){if(err.name==='AbortError')throw new Error('等待超时，服务器可能仍在处理，请刷新当前项目或面试后确认状态。');throw err;} finally{clearTimeout(timer);}
}
async function run(message, fn) {
  if(state.busy)return;
  state.busy=true;const buttons=[...document.querySelectorAll('button')].map(b=>[b,b.disabled]);buttons.forEach(([b])=>b.disabled=true);
  $('#loading-message').textContent=message;$('#loading').hidden=false;
  try{await fn();}catch(error){toast(error.message,true);}finally{state.busy=false;$('#loading').hidden=true;buttons.forEach(([b,d])=>{if(b.isConnected)b.disabled=d;});}
}
function button(text,fn,secondary=false){return el('button',{class:'btn'+(secondary?' secondary':''),type:'button',onclick:fn},text);}
function link(text,url,secondary=false){return el('a',{class:'btn'+(secondary?' secondary':''),href:url,target:'_blank',rel:'noopener'},text);}
function panel(title, ...children){return el('section',{class:'panel'},title?el('div',{class:'panel-title'},el('h2',{},title)):null,...children);}
function head(title,subtitle,actions=[]){return el('div',{class:'page-head'},el('div',{},el('div',{class:'eyebrow'},'YOUR NEXT CHAPTER'),el('h1',{},title),el('p',{class:'subtitle'},subtitle)),el('div',{class:'actions'},actions));}
function pill(text,type=''){return el('span',{class:'pill '+type},text);}
function empty(title,text,action){return el('div',{class:'empty'},el('div',{class:'empty-icon'},'▤'),el('strong',{},title),el('p',{},text),action?el('div',{class:'spacer'}):null,action);}
function note(text,warning=false){return el('div',{class:'note'+(warning?' warning':'')},text);}
function date(text){return new Date(text).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});}
function chooseProject(id){state.projectId=id;id?localStorage.setItem('careerlens.project',id):localStorage.removeItem('careerlens.project');}
function chooseSession(id){state.sessionId=id;localStorage.setItem('careerlens.session',id);}
async function go(route){if(location.hash!=='#'+route)history.pushState(null,'','#'+route);return render();}
function newProject(){if(state.dirty&&!confirm('当前材料尚未保存，确认新建？'))return;state.dirty=false;chooseProject(null);go('materials');}
async function refreshLists(){[state.projects,state.sessions]=await Promise.all([api('/projects'),api('/sessions')]);}
async function health(){
  try{state.health=await api('/health');const h=state.health;$('#health-label').textContent=h.mode==='demo'?'规则演示模式':h.model_ready?`${h.model} · 已就绪`:'模型尚未就绪';$('#refresh-health').classList.toggle('ready',h.model_ready);$('#refresh-health').title=h.message;$('#side-mode').textContent=h.mode==='demo'?'DEMO · 规则演示':'LOCAL · 本地模型';}catch(e){$('#health-label').textContent='应用服务未连接';}
}
function modeNote(){return state.health?.mode==='demo'?note('当前为规则演示：可体验完整工作流，未调用大模型，示例分数不代表语义评估。正式使用请切换 CAREERLENS_MODE=ollama。',true):!state.health?.model_ready?note(state.health?.message||'正在检查本地模型。',true):null;}
function selector(onChange){const select=el('select',{'aria-label':'选择求职项目',onchange:async e=>{if(state.dirty&&!confirm('尚未保存当前编辑，确认切换？')){e.target.value=state.projectId||'';return;}state.dirty=false;chooseProject(e.target.value||null);await onChange();}},el('option',{value:''},'新建求职项目'),state.projects.map(p=>el('option',{value:p.id},p.name)));select.value=state.projectId||'';return select;}
async function selected(){if(!state.projectId)return null;try{return await api('/projects/'+state.projectId);}catch(e){if(!state.projects.some(p=>p.id===state.projectId)){chooseProject(null);return null;}throw e;}}
function projectRow(p){return el('div',{class:'project-item'},el('div',{class:'item-main'},el('div',{class:'project-icon'},'▤'),el('div',{},el('strong',{},p.name),el('small',{},'更新于 '+date(p.updated_at)))),el('div',{class:'actions'},pill(p.analysis_id?'已完成分析':'待诊断',p.analysis_id?'':'gray'),button('打开 →',()=>{chooseProject(p.id);go(p.analysis_id?'analysis':'materials');},true)));}
function sessionRow(s){const names={active:'训练中',paused:'已暂停',completed:'已完成'};return el('div',{class:'project-item'},el('div',{class:'item-main'},el('div',{class:'project-icon'},'◌'),el('div',{},el('strong',{},s.project_name),el('small',{},`${date(s.updated_at)} · ${s.answered}/${s.rounds} 轮 · ${s.mode==='demo'?'规则演示':s.model}`))),el('div',{class:'actions'},pill(names[s.status],s.status==='paused'?'amber':''),button('查看',()=>{chooseSession(s.id);go('interview');},true)));}

function overview(){
  const finished=state.sessions.filter(s=>s.status==='completed').length;
  const hero=el('section',{class:'hero'},el('div',{},el('div',{class:'eyebrow'},'PREPARE WITH PURPOSE'),el('h2',{},'让真实经历，成为你的竞争力。'),el('p',{},'从简历中的一个项目出发，看清岗位要求，练习每一次表达。专属于你的求职教练，在本地陪你准备下一步。'),el('div',{class:'actions'},button('＋ 创建求职项目',newProject),button('体验示例材料',()=>run('加载示例材料',async()=>{chooseProject(null);await go('materials');await loadExample();}),true))),el('div',{class:'hero-art','aria-hidden':'true'},el('div',{class:'orbit'},el('div',{class:'mini-page'},...[1,2,3,4,5].map(()=>el('i')))),el('span',{class:'art-star'},'✧'),el('span',{class:'art-check'},'✓')));
  const stats=el('div',{class:'stat-grid'},[['求职项目',state.projects.length,'一份岗位，一次有针对性的准备'],['模拟面试',state.sessions.length,'每次练习，积累可回顾的经验'],['已完成训练',finished,'看见成长，也看见下一步']].map(([label,n,desc])=>el('div',{class:'stat'},el('span',{},label),el('strong',{},String(n).padStart(2,'0')),el('small',{},desc))));
  const steps=el('div',{},[['01','整理真实经历','导入简历与目标岗位，建立个人材料。'],['02','发现证据与缺口','逐项对应能力要求，获得可追溯建议。'],['03','把准备变成表达','接受针对性追问，积累训练反馈。']].map(([n,title,text])=>el('div',{class:'step'},el('span',{class:'step-number'},n),el('div',{},el('strong',{},title),el('p',{},text)))));
  app.append(head('准备好，开启你的下一步','把经历说清楚，让能力被看见。'),modeNote(),hero,stats,el('div',{class:'grid-two'},panel('我的求职项目',state.projects.length?state.projects.slice(0,4).map(projectRow):empty('还没有求职项目','从简历和一份目标岗位描述开始。',button('创建第一个项目',newProject))),el('div',{},panel('三步，开始一次有效准备',steps,note('建议从一个具体岗位开始。你的所有分析与训练记录都保存在当前设备。')),state.sessions.length?panel('最近一次训练',sessionRow(state.sessions[0])):null)));
}

async function loadExample(){
  if(!$('#resume'))return;
  if(($('#resume').value||$('#job').value)&&!confirm('示例材料会替换当前编辑内容，是否继续？'))return;
  const data=await api('/examples');$('#project-name').value='后端开发实习 · 示例';$('#resume').value=data.resume;$('#job').value=data.job;state.dirty=true;updateCounts();toast('已加载虚构示例，请保存后开始分析');
}
function updateCounts(){for(const id of ['resume','job']){const t=$('#'+id);if(t)$('#'+id+'-count').textContent=`${t.value.length} / ${id==='resume'?5000:3000} 字`;}}
async function materials(){
  const token=pageToken;const p=await selected();if(token!==pageToken)return;
  const form=el('form',{onsubmit:e=>{e.preventDefault();run('保存求职材料',async()=>{
    const data={name:$('#project-name').value,resume:$('#resume').value,job:$('#job').value};
    const saved=await api(p?'/projects/'+p.id:'/projects',{method:p?'PATCH':'POST',body:p?{...data,revision:p.revision}:data});chooseProject(saved.id);state.dirty=false;await refreshLists();toast('材料已保存，可以开始诊断');await render();
  });}});
  const field=(label,id,value,max)=>el('label',{class:'field'},el('span',{class:'field-label'},label,el('small',{id:id+'-count'})),el('textarea',{id,maxlength:max,required:true,oninput:()=>{state.dirty=true;updateCounts();}},value||''));
  const upload=el('div',{class:'upload'},el('span',{},'导入简历 · PDF / DOCX / TXT · 最大 10 MB'),el('label',{for:'resume-file'},'选择文件 ↑'),el('input',{id:'resume-file',type:'file',accept:'.pdf,.docx,.txt',onchange:e=>run('解析求职材料',async()=>{
    const file=e.target.files[0];if(!file)return;if(file.size>10*1024*1024)throw new Error('文件超过 10 MB');const data=new FormData();data.append('file',file);const parsed=await api('/parse',{method:'POST',body:data});if(parsed.text.length>5000)throw new Error('解析文字超过简历 5000 字上限，请精简文件后重新导入');if($('#resume').value&&!confirm('使用文件内容替换当前简历？'))return;$('#resume').value=parsed.text;state.dirty=true;updateCounts();toast(parsed.warning);
  })}));
  const name=el('label',{class:'field'},el('span',{class:'field-label'},'项目名称'),el('input',{id:'project-name',value:p?.name||'',placeholder:'例如：Python 后端实习 · 秋季校招',maxlength:80,required:true,oninput:()=>state.dirty=true}));
  form.append(name,el('div',{class:'editor-grid'},panel('个人简历',upload,field('真实经历与技能','resume',p?.resume,5000),el('p',{class:'muted'},'扫描 PDF 请先做 OCR；导入后请核对提取顺序和内容。')),panel('目标岗位',field('粘贴职位描述（JD）','job',p?.job,3000),note('保留工作职责、任职要求和加分项即可。系统不会自动访问招聘网站。'))),el('div',{class:'actions'},el('button',{type:'submit',class:'btn'},'保存材料'),button('使用示例',()=>run('加载示例',loadExample),true),p?button('进入分析 →',()=>{if(state.dirty){toast('请先保存编辑后的材料',true);return;}go('analysis');},true):null,p?el('button',{class:'btn danger',type:'button',onclick:()=>{if(confirm('删除此项目及其全部分析和面试记录？此操作无法在应用内撤销。'))run('删除项目',async()=>{await api('/projects/'+p.id,{method:'DELETE'});chooseProject(null);state.dirty=false;await refreshLists();await render();toast('项目及关联记录已删除');});}},'删除项目'):null));
  app.append(head('整理材料，准备出发','每一份真实经历，都值得被清晰表达。',[button('＋ 新建项目',newProject,true)]),el('div',{class:'toolbar'},selector(render),el('span',{class:'muted'},p?'编辑并保存后，需重新进行岗位分析。':'先保存材料，再进行诊断和模拟面试。')),form);updateCounts();
}

function matrix(a){return el('div',{class:'table-wrap'},el('table',{},el('thead',{},el('tr',{},['岗位能力','要求','证据状态','简历依据'].map(x=>el('th',{},x)))),el('tbody',{},a.requirements.map(r=>el('tr',{},el('td',{},el('strong',{},r.name),el('details',{},el('summary',{},'查看岗位原文'),el('p',{},r.job_quote))),el('td',{},r.importance==='required'?'必需':'加分'),el('td',{},pill(r.status_label,r.status==='missing'?'amber':r.status==='mentioned'?'gray':'')),el('td',{},r.evidence.length?r.evidence.map(e=>el('div',{class:'evidence'},e.quote,el('small',{},`${e.reason} · 字符位置 ${e.start}–${e.end}`))):el('span',{class:'muted'},'未在材料中找到可核验引用')))))));}
async function analysis(){
  const token=pageToken;const p=await selected();if(token!==pageToken)return;
  app.append(head('看清匹配，也看清成长方向','每项建议都有来处，每项缺口都有下一步。'),modeNote(),el('div',{class:'toolbar'},selector(render),p?button(p.analysis?'重新分析':'开始岗位分析',()=>run('本地模型正在诊断材料',async()=>{await api(`/projects/${p.id}/analyze`,{method:'POST'});await refreshLists();await render();toast('分析完成，引用已经过原文核验');})):null));
  if(!p){app.append(panel('',empty('先建立一份求职材料','导入简历和岗位，才能进行针对性分析。',button('去整理材料',()=>go('materials')))));return;}
  const a=p.analysis;
  if(!a){app.append(panel('',empty('材料已就绪，开始认识你的优势','点击“开始岗位分析”，生成能力证据矩阵和逐条建议。')),note('若模型未连接，请在 Linux 运行 ollama serve，并安装对应模型。'));return;}
  const summary=panel('',el('div',{class:'summary-box'},el('div',{},el('div',{class:'eyebrow'},'EVIDENCE COVERAGE'),el('div',{class:'score-big'},a.match_score,el('small',{},' / 100')),el('span',{class:'muted'},'岗位证据覆盖分')),el('div',{},el('h2',{},'从你的真实材料出发'),el('p',{},a.summary),el('div',{class:'tag-row'},pill(a.mode==='demo'?'规则演示':a.model),pill(`分析用时 ${a.elapsed_seconds} 秒`,'gray')))),el('div',{class:'progress'},el('div',{style:`width:${a.match_score}%`})),el('p',{class:'muted'},'必需项权重 2，加分项权重 1；行动证据计 1，技能提及计 0.4，无证据计 0。此分数不表示录用概率。'));
  const issues=a.issues.map(i=>el('div',{class:'issue'},pill({high:'优先改进',medium:'建议完善',low:'细节优化'}[i.severity],i.severity==='high'?'amber':'gray'),el('div',{class:'evidence'},i.quote),el('p',{},i.problem),el('p',{class:'recommend'},'建议：'+i.suggestion)));
  const missing=a.requirements.filter(r=>r.status!=='proven');
  app.append(summary,panel('岗位能力 · 证据矩阵',matrix(a)),el('div',{class:'grid-two'},panel('逐条材料诊断',issues.length?issues:el('p',{class:'muted'},'未识别到具体问题，建议人工复核。')),panel('下一步，练出你的表达',el('p',{class:'subtitle'},'优先针对证据不足的能力进行训练。'),el('div',{class:'tag-row'},missing.map(r=>pill(r.name,'amber'))),note('没有材料证据不等于不具备能力。可补充真实项目，或在模拟面试中进一步说明。'),el('div',{class:'spacer'}),button('开始模拟面试 →',()=>go('interview')),el('div',{class:'spacer'}),link('打开诊断报告 ↗',`/api/projects/${p.id}/report`,true))),a.validation_warnings.length?note(a.validation_warnings.join('；'),true):null,el('details',{},el('summary',{},'检索参考与分析说明'),...a.retrieved.map(r=>el('div',{class:'evidence'},`${r.source} · ${r.text}`)),el('p',{class:'muted'},'行动证据使用词语规则辅助分类，语义相关性仍需人工复核；模型生成的建议不会自动写入个人简历。')));
}

function radar(scores){
  const ns='http://www.w3.org/2000/svg';const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 340 260');svg.setAttribute('class','radar');svg.setAttribute('role','img');svg.setAttribute('aria-label','六维平均评分雷达图');
  const make=(tag,attrs,text)=>{const n=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,v));if(text)n.textContent=text;svg.append(n);};
  const point=(i,r)=>[170+Math.sin(i*Math.PI/3)*r,128-Math.cos(i*Math.PI/3)*r];
  for(let ring=1;ring<=5;ring++)make('polygon',{points:Array.from({length:6},(_,i)=>point(i,ring*17).join(',')).join(' '),fill:'none',stroke:'#e0e7d9','stroke-width':1});
  const keys=Object.keys(dims);keys.forEach((k,i)=>{const [x,y]=point(i,85);make('line',{x1:170,y1:128,x2:x,y2:y,stroke:'#e0e7d9'});const [tx,ty]=point(i,111);make('text',{x:tx,y:ty,'text-anchor':'middle','font-size':10,fill:'#7d8c72'},dims[k]);});
  make('polygon',{points:keys.map((k,i)=>point(i,scores[k]*17).join(',')).join(' '),fill:'#8bab6d55',stroke:'#72935c','stroke-width':2});return svg;
}
function average(turns){return Object.fromEntries(Object.keys(dims).map(k=>[k,turns.length?Math.round(turns.reduce((n,t)=>n+t.feedback.scores[k],0)/turns.length*10)/10:0]));}
function feedbackCard(t,index){const f=t.feedback;return el('article',{class:'turn'},el('h3',{},`第 ${index+1} 轮 · ${t.question.focus}`),el('p',{},t.question.question),el('p',{class:'turn-answer'},t.answer),el('div',{class:'score-list'},Object.keys(dims).map(k=>el('div',{class:'score-cell'},dims[k],el('b',{},`${f.scores[k]} / 5`)))),el('p',{class:'feedback-text'},f.reason),el('p',{class:'feedback-text'},'亮点：'+f.strengths.join('；')),el('p',{class:'feedback-text'},'改进：'+f.improvements.join('；')),note('练习：'+f.practice));}
async function interview(){
  const token=pageToken;const p=await selected();if(token!==pageToken)return;let s=state.sessionId?state.sessions.find(s=>s.id===state.sessionId):null;
  if(s)s=await api('/sessions/'+s.id);
  if(token!==pageToken)return;
  app.append(head('把准备，变成从容的表达','一问一答，围绕你的经历展开。评分仅供个人练习参考。'),modeNote());
  const rounds=el('select',{'aria-label':'面试轮数'},[5,8,12].map(n=>el('option',{value:n},`${n} 轮训练`)));
  const start=()=>run('准备第一道面试题',async()=>{if(!state.projectId)throw new Error('请先选择求职项目');const created=await api(`/projects/${state.projectId}/sessions`,{method:'POST',body:{rounds:Number(rounds.value)}});chooseSession(created.id);await refreshLists();await render();});
  app.append(panel('选择训练目标',el('div',{class:'toolbar'},selector(render),el('div',{class:'actions'},rounds,button('＋ 开始新面试',start))),p&&!p.analysis?note('当前项目尚未分析，请先到“诊断与匹配”完成分析。',true):null));
  if(!s){app.append(panel('',empty('准备一次有针对性的模拟面试','选择已分析项目并开始训练，系统会依据你的材料进行追问。')));return;}
  const scores=average(s.turns);const status={active:'训练中',paused:'已暂停',completed:'已完成'}[s.status];
  const controls=el('div',{class:'actions'},pill(status,s.status==='paused'?'amber':''),s.status!=='completed'?button(s.status==='active'?'暂停训练':'继续训练',()=>run('更新面试状态',async()=>{await api(`/sessions/${s.id}/state`,{method:'POST',body:{action:s.status==='active'?'pause':'resume',version:s.version}});await refreshLists();await render();}),true):null,link('训练报告 ↗',`/api/sessions/${s.id}/report`,true));
  const training=panel('',el('div',{class:'session-head'},el('div',{},el('h2',{},s.project_name),el('p',{class:'muted'},`已回答 ${s.turns.length} / ${s.rounds} 轮 · ${s.mode==='demo'?'规则演示':s.model}`)),controls),el('div',{class:'progress'},el('div',{style:`width:${s.turns.length/s.rounds*100}%`})));
  if(s.question){training.append(el('div',{class:'interview-question'},el('div',{class:'interviewer'},el('span',{class:'avatar'},'C'),`面试教练 · 第 ${s.turns.length+1} 轮`),el('h2',{},s.question.question),pill(s.question.category),el('span',{class:'muted'},'  关注点：'+s.question.focus)));
    const draftKey=`careerlens.draft.${s.id}.${s.turns.length}`;
    const answer=el('textarea',{class:'interview-input',maxlength:2200,placeholder:'从真实经历出发，说明背景、你的任务、具体行动与结果…','aria-label':'本轮面试回答',disabled:s.status!=='active',oninput:e=>sessionStorage.setItem(draftKey,e.target.value)},sessionStorage.getItem(draftKey)||'');
    training.append(answer,el('div',{class:'actions'},el('button',{class:'btn',disabled:s.status!=='active',onclick:()=>run('分析本轮回答并生成追问',async()=>{if(!answer.value.trim())throw new Error('请先输入回答');const text=answer.value;await api(`/sessions/${s.id}/answer`,{method:'POST',body:{answer:text,version:s.version}});sessionStorage.removeItem(draftKey);await refreshLists();await render();toast('已保存本轮回答与反馈');})},'提交回答 →'),el('span',{class:'muted'},s.status==='paused'?'训练已暂停，点击继续训练恢复。':'草稿仅在当前浏览器会话暂存，提交后保存到本机。')));
  } else training.append(note('本次训练已完成。回顾每轮反馈，整理一份个人项目说明，再开始下一次练习。'));
  app.append(el('div',{class:'grid-two'},el('div',{},training,s.turns.length?panel('逐轮回顾',s.turns.map(feedbackCard)):null),el('div',{},panel('六维训练画像',radar(scores),el('div',{class:'score-list'},Object.keys(dims).map(k=>el('div',{class:'score-cell'},dims[k],el('b',{},`${scores[k]} / 5`)))),note(s.turns.length?'图中展示本次已答轮次的平均分。不同题目和模型的分数不宜直接比较。':'提交第一轮回答后，逐步形成你的训练画像。')),panel('回答小提示',el('div',{class:'step'},el('span',{class:'step-number'},'S'),el('p',{class:'muted'},'先交代背景和任务，让问题有上下文。')),el('div',{class:'step'},el('span',{class:'step-number'},'A'),el('p',{class:'muted'},'重点说明本人采取的行动与选择。')),el('div',{class:'step'},el('span',{class:'step-number'},'R'),el('p',{class:'muted'},'用真实交付物或验证结果收尾。'))))));
}
function historyView(){app.append(head('每次练习，都有迹可循','回顾你的表达，找到下一次训练的重点。'),panel('训练记录',state.sessions.length?state.sessions.map(sessionRow):empty('还没有训练记录','完成材料分析后，开启第一场模拟面试。',button('开始准备',()=>go('materials')))),panel('求职项目',state.projects.length?state.projects.map(projectRow):empty('还没有求职项目','先整理一份简历与目标岗位。')));}

async function render(){
  const token=++pageToken;state.route=location.hash.slice(1) in routes?location.hash.slice(1):'overview';$('#route-label').textContent=routes[state.route];document.querySelectorAll('[data-route]').forEach(a=>a.classList.toggle('active',a.dataset.route===state.route));
  app.replaceChildren(el('p',{class:'muted'},'正在读取本地记录…'));
  try{await refreshLists();if(token!==pageToken)return;app.replaceChildren();await ({overview,materials,analysis,interview,history:historyView}[state.route])();}catch(error){app.replaceChildren(el('div',{class:'error-card'},el('h2',{},'暂时无法读取数据'),el('p',{},error.message),button('重新读取',render,true)));}
}
document.querySelectorAll('nav a,.brand').forEach(a=>a.addEventListener('click',e=>{if(state.busy){e.preventDefault();toast('当前任务正在处理，请稍候');return;}if(state.dirty&&!confirm('编辑内容尚未保存，确认离开？')){e.preventDefault();return;}state.dirty=false;}));
window.addEventListener('beforeunload',e=>{if(state.dirty||state.busy){e.preventDefault();e.returnValue='';}});
window.addEventListener('hashchange',render);
$('#refresh-health').addEventListener('click',()=>run('检查本地模型',async()=>{await health();toast(state.health?.message||'无法连接服务');}));
Promise.all([health(),render()]);
