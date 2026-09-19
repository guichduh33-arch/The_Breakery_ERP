import { test, expect } from '@playwright/test';

// API simulée : valide le parcours et les dimensions sans écrire de production métier.
test('kitchen tablet: touch, scroll, draft recovery and shared-user isolation', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const users = [
    { id: '11111111-1111-4111-8111-111111111111', full_name: 'Chef Pastry', role_code: 'CHEF', employee_code: 'TEST-A' },
    { id: '22222222-2222-4222-8222-222222222222', full_name: 'Chef Bakery', role_code: 'CHEF', employee_code: 'TEST-B' },
  ];
  let active = users[0]!;
  const auth = { access_token: 'fixture-only', refresh_token: 'fixture-only', expires_at: Math.floor(Date.now()/1000)+3600 };
  const permissions = ['inventory.production.kitchen'];
  const stations = [{ id: '33333333-3333-4333-8333-333333333333', name: 'Pastry' }];
  let writes = 0;
  await page.route('**/functions/v1/**', async route => {
    const name = route.request().url().split('/').pop() ?? '';
    if(name === 'auth-verify-pin') active = users.find(u => u.id === (route.request().postDataJSON() as { user_id: string }).user_id) ?? users[0]!;
    await route.fulfill({ json: { user: active, permissions, auth, session_timeout_minutes: 30,
      session: { token: 'fixture-session', session_id: 'fixture-session', created_at: new Date().toISOString() } } });
  });
  await page.route('**/rest/v1/rpc/**', async route => {
    const name = route.request().url().split('/').pop() ?? '';
    const responses: Record<string, unknown> = {
      list_login_users_v1: users.map(u=>({id:u.id,display_name:u.full_name,role:'Chef'})),
      get_kitchen_stations_v1: stations,
      get_kitchen_products_v1: [{ id:'44444444-4444-4444-8444-444444444444',name:'Butter croissant',unit:'pcs',units:[{code:'pcs',factor:1}] }],
      get_kitchen_history_v1: [], get_kitchen_submission_v1: null,
      record_kitchen_production_v1: { batch_id:'fixture-batch',batch_number:'BATCH-DEMO',idempotent_replay:false },
    };
    if(name==='record_kitchen_production_v1') writes++;
    if(!(name in responses)) throw new Error('Unexpected API '+name);
    await route.fulfill({json:responses[name]});
  });
  await page.goto('/login?next=kitchen');
  await page.getByRole('button',{name:'Chef Pastry Chef'}).click();
  await page.getByLabel('PIN for Chef Pastry').fill('123456');
  await page.getByRole('heading',{name:'Kitchen',exact:true}).waitFor();
  await page.getByRole('button',{name:'Butter croissant',exact:true}).click();
  await page.getByLabel('Produced Butter croissant').fill('24');
  await page.getByLabel('Wasted Butter croissant').fill('2');
  await page.getByLabel('Waste reason').selectOption('mis_baked');

  for(const size of [{width:768,height:1024},{width:1024,height:768}]) {
    await page.setViewportSize(size);
    const geometry=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,
      shortControls:[...document.querySelectorAll('main button,main input,main select,header button,header select')].filter(e=>e.getBoundingClientRect().height<48).map(e=>e.outerHTML)}));
    if(geometry.scrollWidth>geometry.width || geometry.shortControls.length) throw new Error(JSON.stringify(geometry));
    await page.getByRole('button',{name:'Refresh history'}).scrollIntoViewIfNeeded();
    const historyBounds=await page.getByRole('button',{name:'Refresh history'}).boundingBox();
    if(!historyBounds || historyBounds.y+historyBounds.height>size.height) throw new Error('History is clipped');
    await page.getByTestId('kitchen-scroll').evaluate(e=>e.scrollTop=0);
    await page.screenshot({path:info.outputPath('kitchen-'+size.width+'.png'),fullPage:true});

  }
  await page.context().setOffline(true);
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b=>b.textContent==='Record production' && b.disabled));
  if(!await page.getByRole('button',{name:'Record production',exact:true}).isDisabled()) throw new Error('Offline write enabled');
  await page.context().setOffline(false);
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b=>b.textContent==='Record production' && !b.disabled));
  await page.reload();
  await page.getByLabel('Produced Butter croissant').waitFor();
  if(await page.getByLabel('Produced Butter croissant').inputValue()!=='24') throw new Error('Draft lost');
  await page.getByRole('button',{name:'Switch user'}).click();
  await page.getByRole('button',{name:'Chef Bakery Chef'}).click();
  await page.getByLabel('PIN for Chef Bakery').fill('123456');
  await page.getByRole('heading',{name:'Kitchen',exact:true}).waitFor();
  if(await page.getByLabel('Produced Butter croissant').count()) throw new Error('Other user draft leaked');
  await page.getByRole('button',{name:'Switch user'}).click();
  await page.getByRole('button',{name:'Chef Pastry Chef'}).click();
  await page.getByLabel('PIN for Chef Pastry').fill('123456');
  await page.getByLabel('Produced Butter croissant').waitFor();
  await page.getByRole('button',{name:'Record production',exact:true}).click();
  await page.getByText('Production recorded: BATCH-DEMO.').waitFor();
  if(writes!==1 || errors.length) throw new Error(JSON.stringify({writes,errors}));
  expect(writes).toBe(1);
  expect(errors).toEqual([]);
});
