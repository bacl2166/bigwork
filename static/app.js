'use strict';
const $ = (s) => document.querySelector(s);
const app = $('#app');
function mount(...children){app.append(...children.filter(child=>child!=null));}
const routes = {overview:'工作台',materials:'求职材料',analysis:'材料诊断',interview:'模拟面试',history:'训练档案'};
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
function icon(name){const ns='http://www.w3.org/2000/svg';const svg=document.createElementNS(ns,'svg');svg.setAttribute('class','icon');svg.setAttribute('aria-hidden','true');const use=document.createElementNS(ns,'use');use.setAttribute('href','#icon-'+name);svg.append(use);return svg;}
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
function head(title,subtitle,actions=[]){return el('div',{class:'page-head'},el('div',{},el('h1',{},title),el('p',{class:'subtitle'},subtitle)),el('div',{class:'actions'},actions));}
function pill(text,type=''){return el('span',{class:'pill '+type},text);}
function empty(title,text,action){return el('div',{class:'empty'},el('div',{class:'empty-icon'},icon('file')),el('strong',{},title),el('p',{},text),action?el('div',{class:'spacer'}):null,action);}
function note(text,warning=false){return el('div',{class:'note'+(warning?' warning':'')},text);}
function date(text){return new Date(text).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});}
function chooseProject(id){state.projectId=id;id?localStorage.setItem('careerlens.project',id):localStorage.removeItem('careerlens.project');}
function chooseSession(id){state.sessionId=id;localStorage.setItem('careerlens.session',id);}
async function go(route){if(location.hash!=='#'+route)history.pushState(null,'','#'+route);return render();}
function newProject(){if(state.dirty&&!confirm('当前材料尚未保存，确认新建？'))return;state.dirty=false;chooseProject(null);go('materials');}
async function refreshLists(){[state.projects,state.sessions]=await Promise.all([api('/projects'),api('/sessions')]);}
async function health(){
  try{state.health=await api('/health');const h=state.health;$('#health-label').textContent=h.mode==='demo'?'规则演示模式':h.model_ready?`${h.model} 已连接`:'模型尚未就绪';$('#refresh-health').classList.toggle('ready',h.model_ready);$('#refresh-health').title=h.message;$('#side-mode').textContent=h.mode==='demo'?'当前使用规则演示':'当前使用本地模型';}catch(e){$('#health-label').textContent='应用服务未连接';}
}
function modeNote(){return state.health?.mode==='demo'?note('当前为规则演示：可体验完整工作流，未调用大模型，示例分数不代表语义评估。正式使用请切换 CAREERLENS_MODE=ollama。',true):!state.health?.model_ready?note(state.health?.message||'正在检查本地模型。',true):null;}
function selector(onChange){const select=el('select',{'aria-label':'选择求职项目',onchange:async e=>{if(state.dirty&&!confirm('尚未保存当前编辑，确认切换？')){e.target.value=state.projectId||'';return;}state.dirty=false;chooseProject(e.target.value||null);await onChange();}},el('option',{value:''},'新建求职项目'),state.projects.map(p=>el('option',{value:p.id},p.name)));select.value=state.projectId||'';return select;}
async function selected(){if(!state.projectId)return null;try{return await api('/projects/'+state.projectId);}catch(e){if(!state.projects.some(p=>p.id===state.projectId)){chooseProject(null);return null;}throw e;}}
function projectRow(p){return el('div',{class:'project-item'},el('div',{class:'item-main'},el('div',{class:'project-icon'},icon('file')),el('div',{},el('strong',{},p.name),el('small',{},'最近更新 '+date(p.updated_at)))),el('div',{class:'actions'},pill(p.analysis_id?'已分析':'待分析',p.analysis_id?'':'gray'),button(p.analysis_id?'查看分析':'编辑材料',()=>{chooseProject(p.id);go(p.analysis_id?'analysis':'materials');},true)));}
function sessionRow(s){const names={active:'训练中',paused:'已暂停',completed:'已完成'};return el('div',{class:'project-item'},el('div',{class:'item-main'},el('div',{class:'project-icon'},icon('chat')),el('div',{},el('strong',{},s.project_name),el('small',{},`${date(s.updated_at)}，已回答 ${s.answered}/${s.rounds} 轮`))),el('div',{class:'actions'},pill(names[s.status],s.status==='paused'?'amber':''),button(s.status==='completed'?'查看记录':'继续面试',()=>{chooseSession(s.id);go('interview');},true)));}

function overview(){
  const finished=state.sessions.filter(s=>s.status==='completed').length;
  const summary=el('div',{class:'workspace-summary'},[['份求职材料',state.projects.length],['次面试练习',state.sessions.length],['次已完成',finished]].map(([label,n])=>el('span',{},el('strong',{},n),label)));
  const create=button('新建项目',newProject);create.prepend(icon('plus'));
  const sample=button('使用示例材料',()=>run('加载示例材料',async()=>{chooseProject(null);await go('materials');await loadExample();}),true);
  const projects=panel('求职项目',el('div',{class:'project-list-heading'},el('span',{},'按目标岗位分别整理'),el('span',{},'状态与操作')),state.projects.length?state.projects.slice(0,5).map(projectRow):empty('还没有求职项目','新建项目后，添加简历和目标岗位。也可以使用示例材料体验完整流程。'));
  const recent=panel('最近面试',state.sessions.length?state.sessions.slice(0,3).map(sessionRow):el('p',{class:'muted'},'完成一次材料分析后，可开始模拟面试。记录会保存在这里。'));
  const active=state.sessions.find(s=>s.status!=='completed');
  const pending=state.projects.find(p=>!p.analysis_id);
  const task=(type,title,description,action,label)=>el('div',{class:'task-entry'},icon(type),el('div',{},el('strong',{},title),el('p',{},description),action?el('button',{class:'task-link',type:'button',onclick:action},label):null));
  const guide=panel('准备事项',el('p',{class:'guide-intro'},'一份求职项目对应一个目标岗位。材料和练习记录放在一起，方便后续复盘。'),
    task('file',pending?'有材料等待分析':'整理求职材料',pending?pending.name:'导入简历，粘贴岗位职责和任职要求。',()=>{if(pending)chooseProject(pending.id);go(pending?'analysis':'materials');},pending?'查看待办':'前往材料'),
    task('check','核对材料依据','查看岗位要求对应的原句，优先补充缺少事实依据的内容。'),
    task('chat',active?'继续未完成的面试':'进行一次面试练习',active?`${active.project_name}，已回答 ${active.answered}/${active.rounds} 轮。`:'选择 5 轮练习，从项目细节和个人贡献开始。',active?()=>{chooseSession(active.id);go('interview');}:null,'继续面试'));
  guide.classList.add('start-guide');
  mount(head('求职工作台','按目标岗位整理材料，查看诊断与面试记录。',[sample,create]),modeNote(),summary,el('div',{class:'overview-grid'},el('div',{},projects,recent),el('aside',{'aria-label':'求职准备提示'},guide,el('div',{class:'aside-note'},el('h3',{},'关于材料与评分'),el('p',{},'匹配分表示材料对岗位要求的覆盖程度。未找到证据，不代表你不具备这项能力。'),el('p',{},'填写真实经历，修改建议请确认后再使用。')))));
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
  const upload=el('div',{class:'upload'},el('span',{},'PDF、DOCX 或 TXT，最大 10 MB'),el('label',{for:'resume-file'},'导入简历'),el('input',{id:'resume-file',type:'file',accept:'.pdf,.docx,.txt',onchange:e=>run('解析求职材料',async()=>{
    const file=e.target.files[0];if(!file)return;if(file.size>10*1024*1024)throw new Error('文件超过 10 MB');const data=new FormData();data.append('file',file);const parsed=await api('/parse',{method:'POST',body:data});if(parsed.text.length>5000)throw new Error('解析文字超过简历 5000 字上限，请精简文件后重新导入');if($('#resume').value&&!confirm('使用文件内容替换当前简历？'))return;$('#resume').value=parsed.text;state.dirty=true;updateCounts();toast(parsed.warning);
  })}));
  const name=el('label',{class:'field'},el('span',{class:'field-label'},'求职项目名称'),el('input',{id:'project-name',value:p?.name||'',placeholder:'例如：Python 后端开发实习',maxlength:80,required:true,oninput:()=>state.dirty=true}));
  form.append(name,el('div',{class:'editor-grid'},panel('个人简历',upload,field('简历正文','resume',p?.resume,5000),el('p',{class:'muted'},'扫描 PDF 请先做 OCR；导入后请核对提取顺序和内容。')),panel('目标岗位',field('职位描述（JD）','job',p?.job,3000),note('粘贴工作职责、任职要求和加分项即可，不需要填写招聘网页链接。'))),el('div',{class:'actions'},el('button',{type:'submit',class:'btn'},'保存材料'),button('使用示例',()=>run('加载示例',loadExample),true),p?button('查看分析',()=>{if(state.dirty){toast('请先保存编辑后的材料',true);return;}go('analysis');},true):null,p?el('button',{class:'btn danger',type:'button',onclick:()=>{if(confirm('删除此项目及其全部分析和面试记录？此操作无法在应用内撤销。'))run('删除项目',async()=>{await api('/projects/'+p.id,{method:'DELETE'});chooseProject(null);state.dirty=false;await refreshLists();await render();toast('项目及关联记录已删除');});}},'删除项目'):null));
  mount(head('求职材料','为一个目标岗位保存一份简历与职位描述。',[button('新建项目',newProject,true)]),el('div',{class:'toolbar'},selector(render),el('span',{class:'muted'},p?'修改并保存材料后，需要重新分析。':'先保存材料，再开始分析。')),form);updateCounts();
}

function matrix(a){
  const rows=a.requirements.map(r=>{
    const citations=r.evidence.length?el('details',{class:'evidence-details',open:!window.matchMedia('(max-width:700px)').matches},
      el('summary',{},`${r.evidence.length} 条原文依据`),
      r.evidence.map(e=>el('div',{class:'evidence'},e.quote,el('small',{},`${e.reason}，字符位置 ${e.start}–${e.end}`)))):
      el('span',{class:'muted'},'未在材料中找到可核验引用');
    return el('tr',{},
      el('td',{},el('strong',{},r.name),el('details',{},el('summary',{},'查看岗位原文'),el('p',{},r.job_quote))),
      el('td',{},r.importance==='required'?'必需':'加分'),
      el('td',{},pill(r.status_label,r.status==='missing'?'amber':r.status==='mentioned'?'gray':'')),
      el('td',{},citations));
  });
  return el('div',{class:'table-wrap'},el('table',{},el('thead',{},el('tr',{},['岗位能力','要求','证据状态','简历依据'].map(x=>el('th',{},x)))),el('tbody',{},rows)));
}
async function analysis(){
  const token=pageToken;const p=await selected();if(token!==pageToken)return;
  mount(head('材料诊断','核对岗位要求与简历依据，查看需要补充的内容。'),modeNote(),el('div',{class:'toolbar'},selector(render),p?button(p.analysis?'重新分析':'开始岗位分析',()=>run('本地模型正在诊断材料',async()=>{await api(`/projects/${p.id}/analyze`,{method:'POST'});await refreshLists();await render();toast('分析完成，引用已经过原文核验');})):null));
  if(!p){mount(panel('',empty('先建立一份求职材料','导入简历和岗位，才能进行针对性分析。',button('去整理材料',()=>go('materials')))));return;}
  const a=p.analysis;
  if(!a){mount(panel('',empty('这份材料尚未分析','点击“开始岗位分析”，生成岗位要求、简历证据和修改建议。')),note('若模型未连接，请在 Linux 运行 ollama serve，并安装对应模型。'));return;}
  const summary=panel('',el('div',{class:'summary-box'},el('div',{},el('div',{class:'score-big'},a.match_score,el('small',{},' / 100')),el('span',{class:'muted'},'岗位证据覆盖分')),el('div',{},el('h2',{},'诊断摘要'),el('p',{},a.summary),el('div',{class:'tag-row'},pill(a.mode==='demo'?'规则演示':a.model),pill(`分析用时 ${a.elapsed_seconds} 秒`,'gray')))),el('div',{class:'progress'},el('div',{style:`width:${a.match_score}%`})),el('p',{class:'muted'},'必需项权重 2，加分项权重 1；行动证据计 1，技能提及计 0.4，无证据计 0。此分数不表示录用概率。'));
  const issues=a.issues.map(i=>el('div',{class:'issue'},pill({high:'优先改进',medium:'建议完善',low:'细节优化'}[i.severity],i.severity==='high'?'amber':'gray'),el('div',{class:'evidence'},i.quote),el('p',{},i.problem),el('p',{class:'recommend'},'建议：'+i.suggestion)));
  const missing=a.requirements.filter(r=>r.status!=='proven');
  mount(summary,panel('岗位能力与材料证据',matrix(a)),el('div',{class:'grid-two'},panel('材料修改建议',issues.length?issues:el('p',{class:'muted'},'未识别到具体问题，建议人工复核。')),panel('建议练习的能力',el('p',{class:'subtitle'},'可在面试中进一步说明以下能力。'),el('div',{class:'tag-row'},missing.map(r=>pill(r.name,'amber'))),note('没有材料证据不等于不具备能力。可补充真实项目，或在模拟面试中进一步说明。'),el('div',{class:'spacer'}),button('开始模拟面试',()=>go('interview')),el('div',{class:'spacer'}),link('查看诊断报告',`/api/projects/${p.id}/report`,true))),a.validation_warnings.length?note(a.validation_warnings.join('；'),true):null,el('details',{},el('summary',{},'检索参考与分析说明'),...a.retrieved.map(r=>el('div',{class:'evidence'},`${r.source} · ${r.text}`)),el('p',{class:'muted'},'行动证据使用词语规则辅助分类，语义相关性仍需人工复核；模型生成的建议不会自动写入个人简历。')));
}

function radar(scores){
  const ns='http://www.w3.org/2000/svg';const svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 340 260');svg.setAttribute('class','radar');svg.setAttribute('role','img');svg.setAttribute('aria-label','六维平均评分雷达图');
  const make=(tag,attrs,text)=>{const n=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([k,v])=>n.setAttribute(k,v));if(text)n.textContent=text;svg.append(n);};
  const point=(i,r)=>[170+Math.sin(i*Math.PI/3)*r,128-Math.cos(i*Math.PI/3)*r];
  for(let ring=1;ring<=5;ring++)make('polygon',{points:Array.from({length:6},(_,i)=>point(i,ring*17).join(',')).join(' '),fill:'none',stroke:'#dce3ec','stroke-width':1});
  const keys=Object.keys(dims);keys.forEach((k,i)=>{const [x,y]=point(i,85);make('line',{x1:170,y1:128,x2:x,y2:y,stroke:'#dce3ec'});const [tx,ty]=point(i,111);make('text',{x:tx,y:ty,'text-anchor':'middle','font-size':11,fill:'#5f6e82'},dims[k]);});
  make('polygon',{points:keys.map((k,i)=>point(i,scores[k]*17).join(',')).join(' '),fill:'#315c9c22',stroke:'#527bb5','stroke-width':2});return svg;
}
function average(turns){return Object.fromEntries(Object.keys(dims).map(k=>[k,turns.length?Math.round(turns.reduce((n,t)=>n+t.feedback.scores[k],0)/turns.length*10)/10:0]));}
function feedbackCard(t,index){const f=t.feedback;return el('article',{class:'turn'},el('h3',{},`第 ${index+1} 轮 · ${t.question.focus}`),el('p',{},t.question.question),el('p',{class:'turn-answer'},t.answer),el('div',{class:'score-list'},Object.keys(dims).map(k=>el('div',{class:'score-cell'},dims[k],el('b',{},`${f.scores[k]} / 5`)))),el('p',{class:'feedback-text'},f.reason),el('p',{class:'feedback-text'},'亮点：'+f.strengths.join('；')),el('p',{class:'feedback-text'},'改进：'+f.improvements.join('；')),note('练习：'+f.practice));}
async function interview(){
  const token=pageToken;const p=await selected();if(token!==pageToken)return;let s=state.sessionId?state.sessions.find(s=>s.id===state.sessionId):null;
  if(s)s=await api('/sessions/'+s.id);
  if(token!==pageToken)return;
  mount(head('模拟面试','围绕简历与岗位练习回答，逐轮查看反馈。评分仅供训练参考。'),modeNote());
  const rounds=el('select',{'aria-label':'面试轮数'},[5,8,12].map(n=>el('option',{value:n},`${n} 轮训练`)));
  const start=()=>run('准备第一道面试题',async()=>{if(!state.projectId)throw new Error('请先选择求职项目');const created=await api(`/projects/${state.projectId}/sessions`,{method:'POST',body:{rounds:Number(rounds.value)}});chooseSession(created.id);await refreshLists();await render();});
  mount(panel('选择面试材料',el('div',{class:'toolbar'},selector(render),el('div',{class:'actions'},rounds,button('新建面试',start))),p&&!p.analysis?note('当前项目尚未分析，请先到“材料诊断”完成分析。',true):null));
  if(!s){mount(panel('',empty('准备一次有针对性的模拟面试','选择已分析项目并开始训练，系统会依据你的材料进行追问。')));return;}
  const scores=average(s.turns);const status={active:'训练中',paused:'已暂停',completed:'已完成'}[s.status];
  const controls=el('div',{class:'actions'},pill(status,s.status==='paused'?'amber':''),s.status!=='completed'?button(s.status==='active'?'暂停训练':'继续训练',()=>run('更新面试状态',async()=>{await api(`/sessions/${s.id}/state`,{method:'POST',body:{action:s.status==='active'?'pause':'resume',version:s.version}});await refreshLists();await render();}),true):null,link('查看训练报告',`/api/sessions/${s.id}/report`,true));
  const training=panel('',el('div',{class:'session-head'},el('div',{},el('h2',{},s.project_name),el('p',{class:'muted'},`已回答 ${s.turns.length} / ${s.rounds} 轮 · ${s.mode==='demo'?'规则演示':s.model}`)),controls),el('div',{class:'progress'},el('div',{style:`width:${s.turns.length/s.rounds*100}%`})));
  if(s.question){training.append(el('div',{class:'interview-question'},el('div',{class:'interviewer'},icon('chat'),`第 ${s.turns.length+1} 轮问题`),el('h2',{},s.question.question),pill(s.question.category),el('span',{class:'muted'},'  关注点：'+s.question.focus)));
    const draftKey=`careerlens.draft.${s.id}.${s.turns.length}`;
    const answer=el('textarea',{class:'interview-input',maxlength:2200,placeholder:'输入你的回答。可以说明当时的任务、你做了什么，以及如何验证结果。','aria-label':'本轮面试回答',disabled:s.status!=='active',oninput:e=>sessionStorage.setItem(draftKey,e.target.value)},sessionStorage.getItem(draftKey)||'');
    training.append(answer,el('div',{class:'actions'},el('button',{class:'btn',disabled:s.status!=='active',onclick:()=>run('分析本轮回答并生成追问',async()=>{if(!answer.value.trim())throw new Error('请先输入回答');const text=answer.value;await api(`/sessions/${s.id}/answer`,{method:'POST',body:{answer:text,version:s.version}});sessionStorage.removeItem(draftKey);await refreshLists();await render();toast('已保存本轮回答与反馈');})},'提交回答'),el('span',{class:'muted'},s.status==='paused'?'训练已暂停，点击继续训练恢复。':'草稿在当前浏览器会话暂存，提交后保存到服务器。')));
  } else training.append(note('本次训练已完成。回顾每轮反馈，整理一份个人项目说明，再开始下一次练习。'));
  mount(el('div',{class:'grid-two'},el('div',{},training,s.turns.length?panel('逐轮回顾',s.turns.map(feedbackCard)):null),el('div',{},panel('本次面试评分',radar(scores),el('div',{class:'score-list'},Object.keys(dims).map(k=>el('div',{class:'score-cell'},dims[k],el('b',{},`${scores[k]} / 5`)))),note(s.turns.length?'展示本次已答轮次的平均分。不同题目和模型的分数不宜直接比较。':'提交第一轮回答后显示评分。')),panel('回答结构参考',el('div',{class:'step'},el('strong',{},'背景与任务'),el('p',{class:'muted'},'当时需要解决什么问题，你承担什么任务？')),el('div',{class:'step'},el('strong',{},'个人行动'),el('p',{class:'muted'},'你做了什么，为什么选择这种方法？')),el('div',{class:'step'},el('strong',{},'结果与验证'),el('p',{class:'muted'},'结果如何，有什么真实依据？'))))));
}
function historyView(){mount(head('训练档案','查看所有求职项目，继续未完成的面试或回顾历史记录。'),panel('面试记录',state.sessions.length?state.sessions.map(sessionRow):empty('还没有面试记录','先保存并分析一份材料，再开始模拟面试。',button('前往求职材料',()=>go('materials')))),panel('求职项目',state.projects.length?state.projects.map(projectRow):empty('还没有求职项目','先添加一份简历和目标岗位。')));}

async function render(){
  const token=++pageToken;state.route=location.hash.slice(1) in routes?location.hash.slice(1):'overview';$('#route-label').textContent=routes[state.route];document.querySelectorAll('[data-route]').forEach(a=>{const active=a.dataset.route===state.route;a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  app.replaceChildren(el('p',{class:'muted'},'正在读取本地记录…'));
  try{await refreshLists();if(token!==pageToken)return;app.replaceChildren();await ({overview,materials,analysis,interview,history:historyView}[state.route])();}catch(error){app.replaceChildren(el('div',{class:'error-card'},el('h2',{},'暂时无法读取数据'),el('p',{},error.message),button('重新读取',render,true)));}
}
document.querySelectorAll('nav a,.brand').forEach(a=>a.addEventListener('click',e=>{if(state.busy){e.preventDefault();toast('当前任务正在处理，请稍候');return;}if(state.dirty&&!confirm('编辑内容尚未保存，确认离开？')){e.preventDefault();return;}state.dirty=false;}));
window.addEventListener('beforeunload',e=>{if(state.dirty||state.busy){e.preventDefault();e.returnValue='';}});
window.addEventListener('hashchange',render);
$('.skip-link').addEventListener('click',e=>{e.preventDefault();app.focus();});
$('#refresh-health').addEventListener('click',()=>run('检查本地模型',async()=>{await health();toast(state.health?.message||'无法连接服务');}));
Promise.all([health(),render()]);
