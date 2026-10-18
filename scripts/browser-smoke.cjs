// Development-only UI acceptance test. Uses the bundled Playwright runtime.
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async()=>{
  const browser=await chromium.launch({headless:true,...(process.env.BROWSER_EXECUTABLE?{executablePath:process.env.BROWSER_EXECUTABLE}:{})});
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    page.on('dialog',d=>d.accept());
    await page.goto(process.env.APP_URL||'http://127.0.0.1:8000');
    await page.getByRole('heading',{name:'求职工作台',exact:true}).waitFor();
    assert.equal(await page.locator('nav [aria-current="page"]').count(),1);
    const firstUrl=page.url();
    await page.locator('.skip-link').focus();
    await page.keyboard.press('Enter');
    assert.equal(page.url(),firstUrl,'skip link must focus content without changing the route');
    assert(await page.locator('#app').evaluate(n=>n===document.activeElement));
    await page.screenshot({path:'test-results/overview-desktop.png',fullPage:true});
    await page.getByRole('button',{name:'使用示例材料',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#resume')?.value.includes('林晓'));
    await page.locator('#project-name').fill('Python 后端实习');
    await page.getByRole('button',{name:'保存材料',exact:true}).click();
    await page.getByRole('button',{name:'查看分析',exact:true}).waitFor();
    await page.screenshot({path:'test-results/materials-desktop.png',fullPage:true});
    await page.getByRole('button',{name:'查看分析',exact:true}).click();
    await page.getByRole('button',{name:'开始岗位分析',exact:true}).click();
    await page.getByRole('heading',{name:'岗位能力与材料证据'}).waitFor();
    assert.equal(await page.locator('#app').evaluate(n=>{const w=document.createTreeWalker(n,NodeFilter.SHOW_TEXT);let c=0;while(w.nextNode())if(w.currentNode.textContent.trim()==='null')c++;return c;}),0,'optional content must not render a null text node');
    assert(await page.getByText('有行动证据',{exact:true}).count()>0);
    await page.screenshot({path:'test-results/analysis-desktop.png',fullPage:true});
    await page.getByRole('button',{name:'开始模拟面试',exact:true}).click();
    await page.getByRole('button',{name:'新建面试',exact:true}).click();
    const answer=page.getByRole('textbox',{name:'本轮面试回答'});
    await answer.waitFor();
    await answer.fill('我开发了图书借阅接口，编写 20 个测试验证了异常分支。');
    await page.getByRole('button',{name:'暂停训练',exact:true}).click();
    await page.getByRole('button',{name:'继续训练',exact:true}).waitFor();
    assert(await answer.isDisabled());
    await page.reload();
    await page.getByRole('button',{name:'继续训练',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.interview-input')?.disabled===false);
    assert((await answer.inputValue()).includes('20 个测试'));
    for(let i=0;i<5;i++){
      if(i)await answer.fill(`第 ${i+1} 轮回答：我负责接口开发和异常处理，使用测试验证结果，并通过 Git 与同学协作完成项目。`);
      await page.getByRole('button',{name:'提交回答',exact:true}).click();
      await page.waitForFunction(n=>document.querySelectorAll('.turn').length===n,i+1);
    }
    await page.getByText('本次训练已完成。',{exact:false}).waitFor();
    const reportHref=await page.getByRole('link',{name:'查看训练报告'}).getAttribute('href');
    const response=await page.request.get(new URL(reportHref,page.url()).href);assert(response.ok());assert((await response.text()).includes('已答 5 / 5 轮'));
    await page.screenshot({path:'test-results/interview-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('link',{name:'工作台',exact:false}).first().click();
    await page.getByRole('heading',{name:'求职工作台',exact:true}).waitFor();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:'test-results/overview-mobile.png',fullPage:true});
    for(const [route,title] of [['materials','求职材料'],['analysis','材料诊断'],['interview','模拟面试'],['history','训练档案']]){
      await page.locator(`nav [data-route="${route}"]`).click();
      await page.getByRole('heading',{name:title,exact:true,level:1}).waitFor();
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${route} overflows mobile viewport`);
      await page.screenshot({path:`test-results/${route}-mobile.png`,fullPage:true});
    }
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({status:'passed',workflow:'create → analyze → pause → reload → resume → five answers → report',consoleErrors:errors.length,mobileWidth:390}));
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
